# Software Team

A reusable software engineering team workflow for Codex, with a local live monitor.

**Current plugin version: 0.3.0 · Status: local pilot**

The coordinator selects only the specialists needed for the current phase. The operating contract defines 13 roles, authority boundaries, evidence standards, independent review, delivery, and release rules. NestJS is the preferred default for new backend projects; Kubernetes is not a default.

## Repository layout

```text
OPERATING-CONTRACT.md          Canonical team agreement
CHANGELOG.md                  Release history
software-team/                Installable plugin package
  plugin.json                 Portable manifest
  .codex-plugin/plugin.json    Compatibility manifest
  skills/software-team/
    SKILL.md                  Coordinator entry point
    references/
      OPERATING-CONTRACT.md    Bundled contract
      LIVE-MONITOR.md          Instrumentation and startup workflow
    scripts/monitor/
      monitor.mjs             Local server and event/command CLI
      monitor.test.mjs        Integration tests
      public/                 Dashboard HTML, CSS, and JavaScript
```

## Use in Codex

Install or select the Software Team plugin using the plugin controls available in your Codex host. This repository contains its package source; cloning it alone does not activate the plugin. If your host accepts plugin archives, package the `software-team/` directory using the instructions below.

Open the target project, select the plugin, provide your spec, and send:

> Use Software Team to implement this spec. Start the live monitor and give me its URL before implementation. Coordinate the smallest sufficient specialist team, maintain tasks and decisions, perform independent review, and report actual verification evidence. Continue within the operating contract's authority boundaries. Keep team documentation in English and discuss progress with me in Persian.

Confirm that the loaded skill includes **Live monitoring**. If an older version remains loaded, refresh/reselect the plugin or start a new project chat.

Actual subagents require host delegation tools. The plugin does not provide its own autonomous agent runtime. It must disclose unavailable capabilities rather than simulate a team.

## Run the monitor manually

Requires **Node.js 20 or newer**. No npm dependency installation is needed.

From the repository root:

```bash
node software-team/skills/software-team/scripts/monitor/monitor.mjs start --project /absolute/path/to/target-project --port 4317
```

Open the URL printed by the process. Use `--port 0` to select a free port. The dashboard is read-only and bound to loopback. Only one monitor writer may own a project.

The target project's `.team-monitor/` directory stores the journal and private connection credentials. Add `.team-monitor/` to that project's `.gitignore`; never commit or share the connection file. Stop a foreground monitor with Ctrl-C. Preserve event history when restarting. For stale-lock handling, see the [monitor workflow](software-team/skills/software-team/references/LIVE-MONITOR.md).

The coordinator and specialists report actual tasks, messages, decisions, and evidence through the event CLI. Relevant commands can run through the wrapper, which captures exit status and duration while excluding arguments and output. See the workflow for event schemas and examples.

## Review completed jobs and request changes

Each delivery job produces full Persian and English reports with a standalone HTML view, diagrams, acceptance/evidence mapping, risks, operations, and next steps. The **Job reports** monitor view links to the report and both Markdown versions. Reports live in `docs/team-reports/<job-id>/r001/` in the target project.

Ask: “Continue job <job-id> from r001. Change REQ-2 as follows: …”. The coordinator inspects current code, applies feedback within agreed authority, reverifies affected behavior, and produces r002 without overwriting r001. Technical completion remains separate from user acceptance and production approval.

The [report workflow](software-team/skills/software-team/references/JOB-REPORTS.md) and [input example](software-team/skills/software-team/assets/report-input.example.json) describe the format. The builder validates structure and references; it does not establish factual truth or semantic translation equivalence.

## Verify

From the repository root:

```bash
node --test software-team/skills/software-team/scripts/monitor/monitor.test.mjs software-team/skills/software-team/scripts/reports/report.test.mjs
```

The pilot passed eight integration tests covering access and validation, live streaming and reconnect, concurrent writes and restart, corrupt journals, command failure propagation, single-writer ownership, long-history retention, and malformed requests. Independent server/security and frontend/UX reviews were performed; reported defects were corrected. Browser checks covered live updates, keyboard focus and dialogs, search, restart recovery, and a 375px mobile viewport.

These checks are not a comprehensive production security or accessibility certification. A fresh spec executed through an updated installed-plugin session remains the next end-to-end validation step.

## Package the plugin

After committing intended changes, run from the repository root:

```bash
git archive --format=zip --prefix=software-team/ --output=../software-team-0.3.0.zip HEAD:software-team
```

The package must contain the plugin, not the entire repository. Keep the manifests' versions synchronized when releasing. The root contract is canonical: when changing it, update its bundled copy and review the diff before packaging. Contract edits require agreement as described in the contract.

Publishing source to GitHub does not automatically update the account plugin. Upload a reviewed plugin release separately when intended. Public plugin-directory submission is a separate process.

## Monitoring boundaries

- Coordination and task state are **agent-reported**; the collection method is visible.
- Command outcomes are captured only when commands use the wrapper.
- Uninstrumented host tools, unreported messages, and hidden model reasoning are outside coverage.
- Connection heartbeat and age of team activity are separate signals.
- A running dashboard does not keep Codex working after its session ends.
- The pilot keeps complete event history in memory and sends it on reconnect. It is intended for bounded local runs, not unlimited telemetry or remote multi-user deployment.

## Sharing

No software license has been selected in this repository. Choose a license before offering reuse rights; publishing a repository alone does not establish an open-source license.
