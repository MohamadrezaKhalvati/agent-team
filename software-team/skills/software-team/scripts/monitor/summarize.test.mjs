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

test('final run status is not overwritten and duplicate completions are ignored with warnings', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [1, { type: 'run.finished', runId: run, status: 'finished' }],
    [2, { type: 'run.updated', runId: run, status: 'running' }],
    [3, { type: 'run.finished', runId: run, status: 'failed' }],
    [4, { type: 'command.started', runId: run, commandId: 'd' }],
    [5, { type: 'command.started', runId: run, commandId: 'd' }],
    [6, { type: 'command.finished', runId: run, commandId: 'd', exitCode: 0, durationMs: 1.7e308 }],
    [7, { type: 'command.finished', runId: run, commandId: 'd', exitCode: 0, durationMs: 1.7e308 }],
    [8, { type: 'command.started', runId: run, commandId: 'e' }],
    [9, { type: 'command.finished', runId: run, commandId: 'e', exitCode: 0, durationMs: 1.7e308 }],
  ]);
  const s = summarizeJournal(text), r = s.runs[0];
  assert.equal(r.status, 'finished');
  assert.equal(r.elapsedMs, 1000);
  assert.deepEqual(r.captured.commands, { started: 2, finished: 2, passed: 2, failed: 0, unfinished: 0, totalDurationMs: 1.7e308 });
  for (const [seq, pattern] of [[4, /duplicate run.finished/i], [6, /duplicate command.started/i], [8, /duplicate command.finished/i], [10, /overflows/i]]) assert.ok(s.warnings.some(w => w.seq === seq && pattern.test(w.message)), 'missing warning for seq ' + seq);
  assert.ok(Number.isFinite(r.captured.commands.totalDurationMs));
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

// ---- Correctness regressions from the independent re-review of 09aca7d ----
const raw = events => events.map((event, i) => JSON.stringify({ source: event.type.startsWith('command.') ? 'command-wrapper' : 'agent-reported', ...event, seq: i + 1 })).join('\n') + '\n';
const keysOf = value => value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]) : [];

test('no field name anywhere in the output reports tokens, cost or cache usage', () => {
  const s = summarizeJournal(complete());
  const offending = keysOf({ ...s, unmeasured: undefined }).filter(key => /token|cost|usd|price|billing|cache/i.test(key));
  assert.deepEqual(offending, []);
  assert.ok(s.unmeasured.includes('model tokens') && s.unmeasured.includes('billing cost') && s.unmeasured.includes('cache usage'));
});

test('an out-of-order run.started timestamp cannot supply a run start time', () => {
  const text = journal([
    [0, { type: 'run.started', runId: 'r1', title: 'A' }],
    [10, { type: 'run.started', runId: 'b', title: 'B' }],
    [3, { type: 'run.started', runId: 'c', title: 'C' }],
    [20, { type: 'run.finished', runId: 'c', status: 'finished' }],
  ]);
  const s = summarizeJournal(text), c = s.runs.find(r => r.runId === 'c');
  assert.ok(s.warnings.some(w => w.seq === 3 && /order/i.test(w.message)));
  assert.equal(c.finished, true);
  assert.equal(c.elapsedMs, null);
  assert.equal(c.observedSpanMs, null);
  assert.ok(s.warnings.some(w => w.runId === 'c' && w.seq === null && /elapsed time unavailable/i.test(w.message)));
});

test('an out-of-order run.finished cannot supply a finish time or task durations', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [5, { type: 'task.updated', runId: run, taskId: 'T1', agentId: 'a', status: 'planned', title: 't' }],
    [30, { type: 'agent.updated', runId: run, agentId: 'a', status: 'working' }],
    [20, { type: 'run.finished', runId: run, status: 'finished' }],
  ]);
  const r = summarizeJournal(text).runs[0];
  assert.equal(r.finished, true);
  assert.equal(r.elapsedMs, null);
  assert.deepEqual(r.agentReported.tasks.stateDurationsMs, {});
  assert.equal(r.agentReported.tasks.openStates, 1);
});

test('task updates after run.finished leave the final task snapshot unchanged and are reported', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [1, { type: 'task.updated', runId: run, taskId: 'T1', agentId: 'a', status: 'planned', title: 't' }],
    [5, { type: 'run.finished', runId: run, status: 'finished' }],
    [9, { type: 'task.updated', runId: run, taskId: 'T1', status: 'running' }],
    [10, { type: 'task.updated', runId: run, taskId: 'T2', agentId: 'a', status: 'planned', title: 'new' }],
  ]);
  const s = summarizeJournal(text), tasks = s.runs[0].agentReported.tasks;
  assert.deepEqual(tasks, { count: 1, statusReports: 1, transitions: 0, reworkTransitions: 0, finalStatusCounts: { planned: 1 }, stateDurationsMs: { planned: 4000 }, openStates: 0 });
  for (const seq of [4, 5]) assert.ok(s.warnings.some(w => w.seq === seq && /after run\.finished/i.test(w.message) && /task/i.test(w.message)), 'missing warning for seq ' + seq);
  assert.equal(s.warnings.filter(w => w.seq === 4).length, 1);
});

test('timestamps must be ISO 8601 with an explicit timezone and a real calendar date', () => {
  const finishAt = '2026-01-01T00:00:10.000Z';
  const elapsedFor = startAt => {
    const s = summarizeJournal(raw([{ type: 'run.started', runId: run, title: 'x', at: startAt }, { type: 'run.finished', runId: run, status: 'finished', at: finishAt }]));
    return [s.runs[0].elapsedMs, s.warnings.some(w => w.seq === 1 && /timestamp/i.test(w.message))];
  };
  for (const valid of ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000000Z', '2026-01-01T03:30:00+03:30', '2025-12-31T19:00:00-05:00', '2024-02-29T00:00:00Z', '2026-01-01T00:00:00z']) {
    assert.equal(elapsedFor(valid)[1], false, valid);
    assert.equal(typeof elapsedFor(valid)[0], 'number', valid);
  }
  assert.equal(elapsedFor('2026-01-01T03:30:00+03:30')[0], 10000);
  for (const invalid of ['1', '2026', '2026-01-01', '2026-01-01T00:00:00', '2026-01-01 00:00:00Z', 'Thu, 01 Jan 2026 00:00:00 GMT', 'January 1, 2026', '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z', '2026-04-31T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:60', '+002026-01-01T00:00:00Z', 20260101, null, '']) {
    assert.deepEqual(elapsedFor(invalid), [null, true], String(invalid));
  }
});

test('an invalid timestamp never becomes the previous-time reference for ordering', () => {
  const text = raw([
    { type: 'run.started', runId: run, title: 'x', at: '2026-01-01T00:00:10.000Z' },
    { type: 'agent.updated', runId: run, agentId: 'a', status: 'working', at: '2999-99-99T00:00:00Z' },
    { type: 'run.finished', runId: run, status: 'finished', at: '2026-01-01T00:00:20.000Z' },
  ]);
  const s = summarizeJournal(text);
  assert.equal(s.runs[0].elapsedMs, 10000);
  assert.equal(s.warnings.filter(w => /order/i.test(w.message)).length, 0);
});

test('command.finished before command.started is counted once and described accurately', () => {
  const text = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [1, { type: 'command.finished', runId: run, commandId: 'a', exitCode: 0, durationMs: 10 }],
    [2, { type: 'command.started', runId: run, commandId: 'a' }],
    [3, { type: 'command.started', runId: run, commandId: 'b' }],
    [4, { type: 'command.finished', runId: run, commandId: 'b', exitCode: 1, durationMs: 5 }],
    [5, { type: 'command.started', runId: run, commandId: 'b' }],
    [6, { type: 'command.finished', runId: run, commandId: 'a', exitCode: 0, durationMs: 10 }],
  ]);
  const s = summarizeJournal(text);
  assert.deepEqual(s.runs[0].captured.commands, { started: 2, finished: 2, passed: 1, failed: 1, unfinished: 0, totalDurationMs: 15 });
  const at = seq => s.warnings.filter(w => w.seq === seq).map(w => w.message).join();
  assert.match(at(2), /without a start/i);
  assert.match(at(3), /after its command\.finished/i);
  assert.doesNotMatch(at(3), /duplicate/i);
  assert.match(at(6), /duplicate command\.started/i);
  assert.match(at(7), /duplicate command\.finished/i);
});

test('run.finished with a nonterminal status is reported as inconsistent, not as completion', () => {
  for (const status of ['running', 'blocked', 'review']) {
    const text = journal([
      [0, { type: 'run.started', runId: run, title: 'x' }],
      [1, { type: 'task.updated', runId: run, taskId: 'T1', agentId: 'a', status: 'planned', title: 't' }],
      [9, { type: 'run.finished', runId: run, status }],
    ]);
    const s = summarizeJournal(text), r = s.runs[0];
    assert.equal(r.finished, false, status);
    assert.equal(r.status, status);
    assert.equal(r.elapsedMs, null);
    assert.equal(r.agentReported.tasks.openStates, 1);
    assert.ok(s.warnings.some(w => w.seq === 3 && /nonterminal/i.test(w.message) && new RegExp(status).test(w.message)), status);
  }
  const later = journal([
    [0, { type: 'run.started', runId: run, title: 'x' }],
    [5, { type: 'run.finished', runId: run, status: 'running' }],
    [8, { type: 'run.finished', runId: run, status: 'verified' }],
  ]);
  const r = summarizeJournal(later).runs[0];
  assert.deepEqual([r.finished, r.status, r.elapsedMs], [true, 'verified', 8000]);
  for (const status of ['finished', 'verified', 'failed']) {
    const ok = summarizeJournal(journal([[0, { type: 'run.started', runId: run, title: 'x' }], [4, { type: 'run.finished', runId: run, status }]]));
    assert.deepEqual([ok.runs[0].finished, ok.runs[0].elapsedMs, ok.warnings.length], [true, 4000, 0], status);
  }
});

test('anomalous journals still summarize deterministically and the CLI leaves them untouched', () => {
  const text = raw([
    { type: 'run.started', runId: run, title: 'x', at: '2026-01-01T00:00:10.000Z' },
    { type: 'command.finished', runId: run, commandId: 'a', exitCode: 0, durationMs: 1, at: '2026-01-01T00:00:05.000Z' },
    { type: 'command.started', runId: run, commandId: 'a', at: 'garbage' },
    { type: 'run.finished', runId: run, status: 'running', at: '2026-01-01T00:00:30.000Z' },
  ]);
  assert.equal(JSON.stringify(summarizeJournal(text)), JSON.stringify(summarizeJournal(text)));
  const dir = project(text), file = join(dir, '.team-monitor', 'events.jsonl'), before = [readFileSync(file, 'utf8'), statSync(file).mtimeMs];
  const result = cli('--project', dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([readFileSync(file, 'utf8'), statSync(file).mtimeMs], before);
});

test('an out-of-order or invalid timestamp never becomes the ordering reference', () => {
  const at = value => `2026-01-01T00:00:${String(value).padStart(2, '0')}.000Z`;
  const out = events => summarizeJournal(raw(events.map(([seconds, event]) => ({ ...event, at: seconds === null ? 'garbage' : at(seconds) })))).warnings.map(w => w.seq);
  const start = { type: 'run.started', runId: run, title: 'x' }, ping = { type: 'agent.updated', runId: run, agentId: 'a', status: 'working' };
  // 10, 5 (late), 7 (still earlier than 10, so also late)
  assert.deepEqual(out([[10, start], [5, ping], [7, ping]]), [2, 3]);
  // an invalid value must not reset the reference: 10, invalid, 5
  assert.deepEqual(out([[10, start], [null, ping], [5, ping]]), [2, 3]);
});

test('untrusted timestamps cannot extend the observed span or open task intervals', () => {
  const t = seconds => `2026-01-01T00:00:${String(seconds).padStart(2, '0')}.000Z`;
  const task = (seconds, extra) => ({ type: 'task.updated', runId: 'x', taskId: 'T1', agentId: 'a', ...extra, at: t(seconds) });
  // another run advances the global reference to 40s, so x's 20s event is late although it is later than x's own last time
  const s = summarizeJournal(raw([
    { type: 'run.started', runId: 'x', title: 'X', at: t(0) },
    { type: 'run.started', runId: 'y', title: 'Y', at: t(40) },
    { type: 'agent.updated', runId: 'x', agentId: 'a', status: 'working', at: t(20) },
  ]));
  assert.equal(s.runs[0].observedSpanMs, 0);
  const late = summarizeJournal(raw([
    { type: 'run.started', runId: 'x', title: 'X', at: t(0) },
    task(30, { status: 'planned', title: 't' }),
    task(10, { status: 'running' }),
    { type: 'run.finished', runId: 'x', status: 'finished', at: t(50) },
  ])).runs[0];
  assert.deepEqual(late.agentReported.tasks.stateDurationsMs, {});
  const fresh = summarizeJournal(raw([
    { type: 'run.started', runId: 'x', title: 'X', at: t(20) },
    task(5, { status: 'planned', title: 't' }),
    { type: 'run.finished', runId: 'x', status: 'finished', at: t(50) },
  ])).runs[0];
  assert.deepEqual(fresh.agentReported.tasks.stateDurationsMs, {});
});
