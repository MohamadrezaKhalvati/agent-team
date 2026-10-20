#!/usr/bin/env node
// Read-only workflow metrics derived from the monitor's event journal. It never writes, never
// contacts the monitor, and reports only what the journal recorded.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './monitor.mjs';

const REWORK_FROM = new Set(['review', 'verified', 'released']);
const REWORK_TO = new Set(['planned', 'running']);
const TERMINAL = new Set(['finished', 'verified', 'failed']);
// Monitor-written timestamps are Date#toISOString() output. Accept only ISO 8601 with an explicit zone and a real calendar date.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i;
function parseTimestamp(value) {
  const m = typeof value === 'string' ? ISO.exec(value) : null;
  if (!m) return null;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = m.slice(1).map(part => Number(part ?? 0));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
  const time = Date.parse(value.toUpperCase());
  return Number.isFinite(time) ? time : null;
}
const UNMEASURED = ['model tokens', 'billing cost', 'cache usage', 'hidden reasoning', 'host tool calls outside the command wrapper', 'activity agents did not report'];
const fail = message => { throw new Error(message); };
const increment = (map, key, by = 1) => { map[key] = (map[key] || 0) + by; };

function parse(text) {
  const events = [];
  text.split('\n').forEach((line, index) => {
    if (!line) return;
    const number = index + 1;
    let raw;
    try { raw = JSON.parse(line); } catch { fail(`Invalid journal: unreadable JSON at line ${number}`); }
    if (!raw || typeof raw !== 'object' || raw.seq !== events.length + 1) fail(`Invalid sequence at line ${number}`);
    const source = raw.source ?? 'agent-reported';
    if (source !== 'agent-reported' && source !== 'command-wrapper') fail(`Invalid journal: unknown source at line ${number}`);
    let event;
    try { event = validate(raw, source); } catch (error) { fail(`Invalid event at line ${number}: ${error.message}`); }
    events.push({ ...event, seq: raw.seq, time: parseTimestamp(raw.at) });
  });
  return events;
}

function newRun(event, time) {
  return { runId: event.runId, title: event.title, status: 'running', finished: false, startedAt: time, finishedAt: null, lastAt: time,
    agents: new Set(), participants: new Set(), messages: 0, decisions: 0, evidence: 0, agentEvents: 0, capturedEvents: 0,
    tasks: new Map(), durations: {}, statusReports: 0, transitions: 0, rework: 0,
    commands: { started: 0, finished: 0, passed: 0, failed: 0, totalDurationMs: 0 }, commandStates: new Map() };
}

export function summarizeJournal(text) {
  const events = parse(text), runs = new Map(), warnings = [];
  const warn = (event, message) => warnings.push({ seq: event.seq, runId: event.runId, message });
  let previous = null;
  for (const event of events) {
    let run = runs.get(event.runId);
    // Only a valid, in-order timestamp is trusted; anything else is excluded from every time measurement.
    let time = event.time;
    if (time === null) warn(event, 'Missing or invalid ISO 8601 timestamp; excluded from durations');
    else if (previous !== null && time < previous) { warn(event, 'Timestamp out of order; excluded from durations'); time = null; }
    else previous = time;
    if (event.type === 'run.started') {
      if (run) fail(`Invalid journal: duplicate run.started for ${event.runId} (seq ${event.seq})`);
      run = newRun(event, time); runs.set(event.runId, run);
    } else if (!run) fail(`Invalid journal: seq ${event.seq} references run ${event.runId} that was never started`);
    if (time !== null && (run.lastAt === null || time > run.lastAt)) run.lastAt = time;
    if (run.finished && event.type !== 'run.finished' && event.type !== 'task.updated') warn(event, 'Event recorded after run.finished');
    if (event.source === 'command-wrapper') run.capturedEvents++; else run.agentEvents++;

    switch (event.type) {
      case 'run.updated': if (!run.finished) run.status = event.status; break;
      case 'run.finished': {
        if (run.finished) { warn(event, 'Duplicate run.finished ignored'); break; }
        if (!TERMINAL.has(event.status)) { run.status = event.status; warn(event, `run.finished carried nonterminal status "${event.status}"; inconsistent source data, run treated as unfinished`); break; }
        run.status = event.status; run.finished = true; run.finishedAt = time;
        for (const task of run.tasks.values()) if (task.since !== null && time !== null) { increment(run.durations, task.status, time - task.since); task.since = null; task.closed = true; }
        break;
      }
      case 'agent.updated': run.agents.add(event.agentId); break;
      case 'message.sent': run.messages++; run.participants.add(event.agentId); run.participants.add(event.to); break;
      case 'decision.recorded': run.decisions++; break;
      case 'evidence.recorded': run.evidence++; break;
      case 'task.updated': {
        if (run.finished) { warn(event, 'Task update after run.finished ignored; final task snapshot unchanged'); break; }
        run.statusReports++;
        let task = run.tasks.get(event.taskId);
        if (!task) { task = { status: event.status, since: time, closed: false }; run.tasks.set(event.taskId, task); break; }
        if (task.since !== null && time !== null) increment(run.durations, task.status, time - task.since);
        if (task.status !== event.status) {
          run.transitions++;
          if (REWORK_FROM.has(task.status) && REWORK_TO.has(event.status)) run.rework++;
        }
        task.status = event.status; task.since = time; task.closed = false;
        break;
      }
      case 'command.started': {
        const command = run.commandStates.get(event.commandId);
        if (!command) { run.commandStates.set(event.commandId, { started: true, finished: false }); run.commands.started++; break; }
        if (command.started) { warn(event, 'Duplicate command.started ignored'); break; }
        command.started = true; run.commands.started++;
        warn(event, 'command.started recorded after its command.finished (out of order)');
        break;
      }
      case 'command.finished': {
        const command = run.commandStates.get(event.commandId);
        if (command?.finished) { warn(event, 'Duplicate command.finished ignored'); break; }
        if (command) command.finished = true;
        else { run.commandStates.set(event.commandId, { started: false, finished: true }); warn(event, 'Command finished without a start event'); }
        run.commands.finished++;
        if (event.exitCode === 0 && !event.signal) run.commands.passed++; else run.commands.failed++;
        if (Number.isFinite(event.durationMs)) {
          if (Number.isFinite(run.commands.totalDurationMs + event.durationMs)) run.commands.totalDurationMs += event.durationMs;
          else warn(event, 'Command duration overflows the total; excluded');
        }
        break;
      }
      default: break;
    }
  }
  const summaries = [...runs.values()].map(run => {
    const elapsed = run.finished && run.startedAt !== null && run.finishedAt !== null ? run.finishedAt - run.startedAt : null;
    if (run.finished && elapsed === null) warnings.push({ seq: null, runId: run.runId, message: 'Run finished but start or finish timestamp is unusable; elapsed time unavailable' });
    const finalStatusCounts = {};
    for (const task of run.tasks.values()) increment(finalStatusCounts, task.status);
    return {
      runId: run.runId, title: run.title, status: run.status, finished: run.finished,
      elapsedMs: elapsed,
      observedSpanMs: run.startedAt !== null && run.lastAt !== null ? run.lastAt - run.startedAt : null,
      timeBasis: 'monitor receipt time, not when work occurred',
      provenance: { agentReported: 'agent-reported', captured: 'command-wrapper' },
      agentReported: {
        events: run.agentEvents, agentsRegistered: run.agents.size, messages: run.messages,
        messageParticipantsUnregistered: [...run.participants].filter(id => !run.agents.has(id)).length,
        decisions: run.decisions, evidenceRecords: run.evidence,
        tasks: { count: run.tasks.size, statusReports: run.statusReports, transitions: run.transitions, reworkTransitions: run.rework,
          finalStatusCounts, stateDurationsMs: run.durations, openStates: [...run.tasks.values()].filter(task => !task.closed).length },
      },
      captured: { events: run.capturedEvents, commands: { ...run.commands, unfinished: [...run.commandStates.values()].filter(command => command.started && !command.finished).length } },
    };
  });
  return { schema: 'team-journal-summary/1', eventCount: events.length, runs: summaries, warnings, unmeasured: UNMEASURED };
}

function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--project', '--journal'].includes(args[i]) || !args[i + 1]) fail('Usage: summarize.mjs --project <dir> | --journal <events.jsonl>');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (Boolean(options.project) === Boolean(options.journal)) fail('Usage: summarize.mjs --project <dir> | --journal <events.jsonl>');
  const file = options.journal ? resolve(options.journal) : join(resolve(options.project), '.team-monitor', 'events.jsonl');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (error) { fail(error.code === 'ENOENT' ? `Journal not found: ${file}` : `Cannot read journal: ${error.message}`); }
  console.log(JSON.stringify(summarizeJournal(text), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
