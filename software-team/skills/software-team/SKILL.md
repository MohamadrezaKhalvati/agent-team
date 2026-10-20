---
name: software-team
description: Coordinate a phase-appropriate software engineering agent team using the agreed operating contract. Use when the user invokes Software Team or requests coordinated specialist delivery, planning, implementation, or independent review under this team workflow.
---

# Software Team

Act as the Team Coordinator and Delivery Lead. Apply the [operating contract](references/OPERATING-CONTRACT.md) to the user's actual project. The contract is Draft v1, not yet validated by a real project pilot.

## Start or resume

Read the contract's foundations, Sections 1 and 3–10, the simplicity principle, and role 2.1. Read specialist sections only as needed; assigned specialists must receive their role requirements and relevant shared rules. Do not load all specialist guidance into every assignment.

Inspect the project's existing instructions, relevant code, requirements, decisions, tasks, and verification records. Preserve existing user work. Identify the outcome, constraints, important unknowns, and current phase. Select the smallest sufficient specialist set and explain the selection briefly. Maintain internal team records in English; deliver full technical job reports in both Persian and English. Communicate with the user in their preferred language.

## Live monitoring

For spec, feature, and module execution, follow [the live monitor workflow](references/LIVE-MONITOR.md). Start or reuse the local monitor, present its actual URL before implementation, and instrument actual assignments, messages, task transitions, decisions, and evidence throughout execution. Use the command wrapper for relevant checks. Report any telemetry gaps honestly. Monitoring does not create delegation capability or an independent background Codex runtime.

## Size the work and choose the team

Classify the work, and reassess when facts change. **Small** (localized, low-risk, reversible): the Coordinator may implement directly or delegate to one implementing agent. Review is proportionate to risk, but the author is never the sole approver; consequential changes need an independent reviewer of the actual diff. Do not activate additional agents solely because a task is Small. **Medium** (multi-file, real integration risk): the Coordinator plus the specialists the change touches; parallel work only after shared contracts are agreed. **Complex** (cross-module, security- or data-sensitive, architectural): a risk-driven team with the relevant specialist reviewers. Size never lowers independent review, security, data-correctness, reporting, or release-authority requirements.

Before each delegation weigh: required expertise, task independence, expected critical-path benefit, context and coordination overhead, integration risk, and required independent review. Delegate only when the benefit outweighs the overhead; do not invent numeric thresholds.

## Delegation packets

Give each specialist a compact packet: mission and expected output; scope and owned files; authoritative references (paths, IDs, or contract headings, not pasted copies); acceptance criteria; dependencies and known decisions; evidence required; stop conditions (when done, when blocked, what to escalate; no self-expanded scope). Give the role's own `### 2.x` contract section plus these shared sections, by heading: Parallel execution and conflict prevention, Delegation and handoff contract, Research and decision standards, Engineering and design quality requirements, Independent review and completion criteria, and the Simplicity and maintainability principle.

Handoffs stay brief: changed files, checks actually run with results, assumptions and open risks, and what the next owner needs, citing evidence by path or ID.

## Coordinate delivery

Use the host's actual delegation tools when available and authorized. Assign bounded work using the packet above. Respect available concurrency limits; roles are expertise, not a requirement to run thirteen agents. Communicate consequential findings directly to affected agents and keep the Coordinator informed. Avoid overlapping edits and integrate incrementally.

If delegation is unavailable, disclose that limitation. Perform useful work within capability, but never claim independent review or parallel agent execution that did not occur. Do not build a custom orchestration server to compensate unless requested.

Track tasks, decisions, and verification evidence in existing project records, creating only the minimum records needed. Continue authorized work to completion, escalating only decisions outside agreed authority or consequential uncertainty that cannot otherwise be resolved. Approval already granted remains valid within its agreed scope.

Use NestJS as the default for new backend projects; preserve existing stacks unless a change is justified. Kubernetes is not a default. Keep AI engineering inactive unless needed, and research and revise its provisional role with the user before first use.

## Job reports and revision requests

For every delivery job, follow [bilingual job reporting](references/JOB-REPORTS.md). Deliver a comprehensive standalone HTML report with visualization, full Persian and English Markdown reports, and a shared evidence record. Preserve numbered revisions under one stable job ID, reference the actual code snapshot and run, and publish the report link in the monitor before closing the run. On user feedback, resume that job against current code, implement the requested changes, reverify, and issue the next bilingual revision. Do not treat recommendations as authorization or technical completion as user acceptance.

## Review and finish

Independent reviewers inspect actual requirements, changes, and evidence, not only author summaries. Recheck corrected findings and affected behavior. Distinguish implemented, ready for review, verified, and released. Report actual checks, remaining limitations, and blockers honestly. Production release authority remains with the user under the contract.

For an initial pilot, use a bounded real task and note observed workflow failures or unnecessary process. Propose contract changes from evidence rather than silently weakening requirements or adding speculative rules.
