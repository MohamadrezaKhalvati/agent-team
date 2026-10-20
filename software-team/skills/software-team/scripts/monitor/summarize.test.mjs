import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarizeJournal } from './summarize.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = seconds => new Date(T0 + seconds * 1000).toISOString();
// Build a journal the way the monitor persists it: sequential seq, server timestamp, provenance label.
function journal(events) {
  return events.map(([seconds, event, source = event.type.startsWith('command.') ? 'command-wrapper' : 'agent-reported'], i) => JSON.stringify({ ...event, source, seq: i + 1, at: seconds === null ? undefined : at(seconds) })).join('\n') + '\n';
}
const run = 'r1';
const complete = () => journal([
  [0, { type: 'run.started', runId: run, title: 'Feature' }],
  [1, { type: 'agent.updated', runId: run, agentId: 'coordinator', status: 'working' }],
  [2, { type: 'agent.updated', runId: run, agentId: 'backend', status: 'working' }],
  [3, { type: 'task.updated', runId: run, taskId: 'T1', agentId: 'backend', status: 'planned', title: 'Build' }],
  [10, { type: 'task.updated', runId: run, taskId: 'T1', status: 'running' }],
  [12, { type: 'message.sent', runId: run, agentId: 'coordinator', to: 'backend', summary: 'go' }],
  [13, { type: 'message.sent', runId: run, agentId: 'backend', to: 'reviewer', summary: 'hand off' }],
  [14, { type: 'decision.recorded', runId: run, title: 'D1' }],
  [15, { type: 'evidence.recorded', runId: run, title: 'E1' }],
  [20, { type: 'command.started', runId: run, commandId: 'c1', command: 'node' }],
  [25, { type: 'command.finished', runId: run, commandId: 'c1', exitCode: 0, durationMs: 5000, result: 'passed' }],
  [26, { type: 'command.started', runId: run, commandId: 'c2', command: 'node' }],
  [27, { type: 'command.finished', runId: run, commandId: 'c2', exitCode: 1, durationMs: 700, result: 'failed' }],
  [28, { type: 'command.started', runId: run, commandId: 'c3', command: 'node' }],
  [40, { type: 'task.updated', runId: run, taskId: 'T1', status: 'review' }],
  [50, { type: 'task.updated', runId: run, taskId: 'T1', status: 'running' }],
  [70, { type: 'task.updated', runId: run, taskId: 'T1', status: 'review' }],
  [80, { type: 'task.updated', runId: run, taskId: 'T1', status: 'verified' }],
  [100, { type: 'run.finished', runId: run, status: 'verified', summary: 'done' }],
]);

test('summarizes a complete run from recorded events only', () => {
  const s = summarizeJournal(complete());
  assert.equal(s.runs.length, 1);
  const r = s.runs[0];
  assert.equal(r.finished, true);
  assert.equal(r.status, 'verified');
  assert.equal(r.elapsedMs, 100000);
  assert.equal(r.agentReported.agentsRegistered, 2);
  assert.equal(r.agentReported.messages, 2);
  assert.equal(r.agentReported.decisions, 1);
  assert.equal(r.agentReported.evidenceRecords, 1);
  assert.equal(r.agentReported.tasks.count, 1);
  assert.equal(r.agentReported.tasks.statusReports, 6);
  assert.equal(r.agentReported.tasks.transitions, 5);
  assert.equal(r.agentReported.tasks.reworkTransitions, 1);
  assert.deepEqual(r.agentReported.tasks.finalStatusCounts, { verified: 1 });
  // planned 3→10, running 10→40 and 50→70, review 40→50 and 70→80, verified 80→100 (open at run end)
  assert.deepEqual(r.agentReported.tasks.stateDurationsMs, { planned: 7000, running: 50000, review: 20000, verified: 20000 });
  assert.deepEqual(r.captured.commands, { started: 3, finished: 2, passed: 1, failed: 1, unfinished: 1, totalDurationMs: 5700 });
});

test('labels provenance and never reports tokens or cost', () => {
  const s = summarizeJournal(complete());
  assert.equal(s.runs[0].provenance.agentReported, 'agent-reported');
  assert.equal(s.runs[0].provenance.captured, 'command-wrapper');
  assert.equal(s.runs[0].timeBasis, 'monitor receipt time, not when work occurred');
  assert.ok(s.unmeasured.includes('model tokens') && s.unmeasured.includes('billing cost'));
  assert.ok(!/token(s)?"\s*:|cost"\s*:/i.test(JSON.stringify(s.runs)));
});

test('incomplete run has no elapsed time and open states are not invented', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'Open' }],
    [5, { type: 'task.updated', runId: run, taskId: 'T1', agentId: 'a', status: 'planned', title: 'x' }],
    [20, { type: 'task.updated', runId: run, taskId: 'T1', status: 'running' }],
  ]);
  const r = summarizeJournal(text).runs[0];
  assert.equal(r.finished, false);
  assert.equal(r.elapsedMs, null);
  assert.equal(r.observedSpanMs, 20000);
  assert.deepEqual(r.agentReported.tasks.stateDurationsMs, { planned: 15000 });
  assert.equal(r.agentReported.tasks.openStates, 1);
});

test('unreadable or missing timestamps are reported and excluded, not guessed', () => {
  const lines = complete().trim().split('\n').map(l => JSON.parse(l));
  lines[4].at = 'not-a-date';
  lines[5].at = undefined;
  const s = summarizeJournal(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  assert.ok(s.warnings.some(w => w.seq === 5 && /timestamp/i.test(w.message)));
  assert.ok(s.warnings.some(w => w.seq === 6 && /timestamp/i.test(w.message)));
  assert.equal(s.runs[0].elapsedMs, 100000);
  assert.equal(s.runs[0].agentReported.tasks.statusReports, 6);
});

test('out-of-order timestamps skip the interval with a warning', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [30, { type: 'task.updated', runId: run, taskId: 'T1', agentId: 'a', status: 'planned', title: 't' }],
    [10, { type: 'task.updated', runId: run, taskId: 'T1', status: 'running' }],
    [50, { type: 'run.finished', runId: run, status: 'finished' }],
  ]);
  const s = summarizeJournal(text);
  assert.ok(s.warnings.some(w => w.seq === 3 && /order/i.test(w.message)));
  assert.equal(s.runs[0].agentReported.tasks.stateDurationsMs.planned, undefined);
});

test('command pairing handles orphans, signals and duplicate completions', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [1, { type: 'command.finished', runId: run, commandId: 'orphan', exitCode: 0, durationMs: 10 }],
    [2, { type: 'command.started', runId: run, commandId: 'sig' }],
    [3, { type: 'command.finished', runId: run, commandId: 'sig', exitCode: null, signal: 'SIGTERM', durationMs: 5 }],
  ]);
  const s = summarizeJournal(text);
  assert.deepEqual(s.runs[0].captured.commands, { started: 1, finished: 2, passed: 1, failed: 1, unfinished: 0, totalDurationMs: 15 });
  assert.ok(s.warnings.some(w => /without a start/i.test(w.message)));
});

test('events after run.finished are reported', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [1, { type: 'run.finished', runId: run, status: 'finished' }],
    [2, { type: 'decision.recorded', runId: run, title: 'late' }],
  ]);
  assert.ok(summarizeJournal(text).warnings.some(w => w.seq === 3 && /after run\.finished/i.test(w.message)));
});

test('separates runs and orders them by first appearance', () => {
  const text = journal([
    [0, { type: 'run.started', runId: 'b', title: 'B' }],
    [1, { type: 'run.started', runId: 'a', title: 'A' }],
    [2, { type: 'agent.updated', runId: 'a', agentId: 'x', status: 'working' }],
  ]);
  const s = summarizeJournal(text);
  assert.deepEqual(s.runs.map(r => r.runId), ['b', 'a']);
  assert.equal(s.runs[1].agentReported.agentsRegistered, 1);
  assert.equal(s.runs[0].agentReported.agentsRegistered, 0);
});

test('same journal always produces identical output', () => {
  const text = complete();
  assert.equal(JSON.stringify(summarizeJournal(text)), JSON.stringify(summarizeJournal(text)));
});

test('empty journal yields no runs', () => {
  assert.deepEqual(summarizeJournal('').runs, []);
});

test('invalid journals are rejected with the offending line', () => {
  const good = complete().trim().split('\n');
  assert.throws(() => summarizeJournal(good.slice(0, 2).join('\n') + '\n{broken\n'), /line 3/i);
  assert.throws(() => summarizeJournal([good[0], good[2]].join('\n') + '\n'), /sequence.*line 2/i);
  const unknown = JSON.parse(good[1]); unknown.type = 'mystery.event';
  assert.throws(() => summarizeJournal([good[0], JSON.stringify(unknown)].join('\n') + '\n'), /line 2/i);
  const spoof = JSON.parse(good[1]); spoof.type = 'command.finished'; spoof.source = 'agent-reported';
  assert.throws(() => summarizeJournal([good[0], JSON.stringify(spoof)].join('\n') + '\n'), /line 2/i);
});

function project(content) {
  const dir = mkdtempSync(join(tmpdir(), 'team-summary-'));
  if (content !== undefined) { mkdirSync(join(dir, '.team-monitor')); writeFileSync(join(dir, '.team-monitor', 'events.jsonl'), content); }
  return dir;
}
const cli = (...args) => spawnSync(process.execPath, [join(HERE, 'summarize.mjs'), ...args], { encoding: 'utf8' });

test('CLI reads a project journal without modifying it', () => {
  const dir = project(complete());
  const file = join(dir, '.team-monitor', 'events.jsonl');
  const before = [readFileSync(file, 'utf8'), statSync(file).mtimeMs];
  const result = cli('--project', dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).runs[0].runId, run);
  assert.deepEqual([readFileSync(file, 'utf8'), statSync(file).mtimeMs], before);
  assert.equal(cli('--journal', file).stdout, result.stdout);
});

test('CLI fails closed on a missing or corrupt journal and leaves it untouched', () => {
  assert.notEqual(cli('--project', project()).status, 0);
  const dir = project('{not json\n');
  const file = join(dir, '.team-monitor', 'events.jsonl');
  const result = cli('--project', dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /line 1/);
  assert.equal(result.stdout, '');
  assert.equal(readFileSync(file, 'utf8'), '{not json\n');
  assert.notEqual(cli().status, 0);
});
