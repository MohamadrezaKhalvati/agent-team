const TERMINAL = new Set(['finished', 'verified', 'failed']);
const FROZEN = new Set(['run.updated', 'task.updated', 'agent.updated']);
export function lifecycle(run, event) {
  if (run?.finished) {
    if (event.type === 'run.finished') return { reject: true, ignore: true, warning: 'Duplicate run.finished ignored' };
    if (FROZEN.has(event.type)) return { reject: true, ignore: true, warning: `${event.type} after run.finished ignored; final snapshot unchanged` };
    return { warning: 'Late evidence event recorded after run.finished' };
  }
  if (event.type === 'run.finished' && !TERMINAL.has(event.status)) return { reject: true, warning: `run.finished carried nonterminal status "${event.status}"; inconsistent source data, run treated as unfinished` };
  if (event.type === 'run.updated' && TERMINAL.has(event.status)) return { reject: true, warning: 'Terminal status on run.updated; run remains unfinished until run.finished' };
  return { finish: event.type === 'run.finished' };
}
export function applyProjection(runs, event) {
  let run = runs.get(event.runId);
  if (event.type === 'run.started' && !run) {
    run = { runId: event.runId, title: event.title, status: 'running', finished: false, tasks: new Map(), agents: new Map(), warnings: [] };
    runs.set(event.runId, run);
  }
  if (!run) return;
  const decision = lifecycle(run, event);
  if (decision.warning) run.warnings.push({ seq: event.seq, message: decision.warning });
  if (decision.ignore) return;
  if (event.type.startsWith('run.')) {
    const { tasks, agents, warnings, finished } = run;
    Object.assign(run, event, { tasks, agents, warnings, finished: finished || !!decision.finish });
    if (event.type === 'run.started') run.status = 'running';
  }
  if (event.type === 'task.updated') run.tasks.set(event.taskId, { ...run.tasks.get(event.taskId), ...event });
  if (event.type === 'agent.updated') run.agents.set(event.agentId, { ...run.agents.get(event.agentId), ...event });
}
