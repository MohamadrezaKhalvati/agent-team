# Live monitor workflow

Use this workflow when executing a spec, feature, or module with Software Team. Start or reuse the monitor before implementation, give the user its URL, and keep it updated throughout actual work. This is a local Node.js utility, separate from the product backend. Node 20+ is required; no package installation is needed.

## Start or reuse

Resolve `scripts/monitor/monitor.mjs` relative to this skill's installed directory. Choose the actual target project as `PROJECT`; never hardcode the author's development path.

Start with the host's background-process execution facility:

```text
node <skill-directory>/scripts/monitor/monitor.mjs start --project <absolute-project> --port 4317
```

The process prints a loopback URL and connection-file path, never credentials. Keep it running and immediately show the clickable URL to the user. If the port is occupied, choose another port or use `--port 0` and show the actual printed URL. Do not stop unrelated processes.

Only one writer may own a project. If a monitor is already running, reuse the project's `.team-monitor/connection.json` after checking its loopback `/api/state` responds for the intended project. Never print or expose the connection tokens. If a writer lock is stale, confirm the recorded PID is no longer active before removing only that lock file. Do not delete or truncate event history.

Add `.team-monitor/` to the project's existing `.gitignore` without replacing other entries. It holds private runtime connection credentials and the local event journal; do not include it in commits, screenshots, plugin archives, or reports. Do not log credentials, sensitive user data, full prompts, command arguments, or command output.

## Register actual work

Create one unique run ID per spec execution. Read the spec and record an accurate summary, not sensitive contents. Write event JSON to a temporary file using a structured file tool, then emit it:

```text
node <skill-directory>/scripts/monitor/monitor.mjs emit --connection <project>/.team-monitor/connection.json --file <event-file.json>
```

Example event:

```json
{"type":"run.started","runId":"feature-unique-id","title":"Feature title","summary":"Expected outcome and phase"}
```

The server assigns sequence, timestamp, and provenance. Emit actual events as they occur, not simulated schedules or invented historical timestamps. Every event requires `runId`. Useful event types:

| Type | Required fields and usage |
| --- | --- |
| run.started | Unique runId, title; optional summary |
| run.updated | status: running, blocked, review, verified, failed, or finished; optional summary |
| run.finished | Final status and honest result summary |
| agent.updated | agentId, status: working, waiting, done, or blocked; title and role on first registration |
| task.updated | taskId, status: planned, running, blocked, review, verified, or released; title and owner agentId on first registration |
| message.sent | Actual sender agentId, recipient to, summary of a message actually sent or received |
| decision.recorded | title, summary; optional details and supporting path |
| evidence.recorded | title, summary; optional result, path, taskId, details |
| report.ready | title and generated /reports/<job-id>/r001/report.html path; runId must match the stored report |

Give each subagent its role, task, shared record locations, and monitor connection path. When shell/file tools are available, ask it to report its own starts, blockers, consequential messages and handoffs. Otherwise the Coordinator mirrors actual host messages and labels them through the same agent-reported event path. Update both sender and task identity accurately. Creating a dashboard node does not create a subagent; use the host delegation tool first.

## Capture command outcomes

Run relevant tests and build checks through the wrapper:

```text
node <skill-directory>/scripts/monitor/monitor.mjs record --connection <connection-file> --run <run-id> --agent <agent-id> --task <task-id> --label "Relevant check" --cwd <project> -- <executable> <arguments>
```

It records command start, exit code or signal, and duration. Output stays in the terminal; arguments and stdout/stderr are deliberately excluded from the journal. The wrapper preserves failed exit status. It uses no shell: pass executables and arguments separately. Use project-appropriate execution timeouts in the host. A failed telemetry write must be reported, not silently ignored.

Agent-reported evidence must identify actual artifact paths or check results without implying automatic verification. Only the wrapper produces captured command events. This provenance distinction explains the collection method; it is not cryptographic proof against a malicious local process with access to the credential file.

## Finish and limitations

After independent review, generate and review the bilingual report using JOB-REPORTS.md, publish report.ready, then record resolved findings, accurate final task/agent states, and a run.finished event. Distinguish verification from production release. Leave the read-only dashboard available and tell the user its URL and runtime limitations.

To review workflow counts and durations afterwards, run `node <skill-directory>/scripts/monitor/summarize.mjs --project <project>`. It reads the journal read-only and reports agent-reported and wrapper-captured data separately, using monitor receipt times. It does not record or estimate model tokens or cost.

Coverage includes explicit agent reports and wrapped command outcomes, not all host tool calls, unreported communications, hidden reasoning, or continuous autonomous execution. The monitor server heartbeat proves connection health, not agent liveness. The UI separately shows the age of team activity. After a host session ends, dashboard persistence depends on the process facility used; the monitor does not keep Codex working in the background.

This pilot keeps the complete journal in memory and sends it on reconnect to preserve run/task state. It is intended for bounded local runs, not unlimited high-volume telemetry. Historical events remain on disk across normal restarts. Corrupt journals fail closed for inspection. Stop the monitor with Ctrl-C in its terminal or terminate its verified server PID when requested; never stop the whole application runtime.
