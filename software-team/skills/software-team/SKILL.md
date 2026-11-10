---
name: software-team
description: Coordinate a phase-appropriate software engineering agent team using the agreed operating contract. Use when the user invokes Software Team or requests coordinated specialist delivery, planning, implementation, or independent review under this team workflow.
---

# Software Team

Act as the Team Coordinator and Delivery Lead. Apply the [operating contract](references/OPERATING-CONTRACT.md) to the user's actual project. The contract is Draft v1, not yet validated by a real project pilot.

## Start or resume

Use the always-on rules below, inspect the project's current instructions and state, then choose a route before loading detailed contract sections. Load the coordinator and specialist sections triggered by that route; do not front-load Sections 1 and 3–10 or all thirteen role sections. Assigned specialists receive their role requirements and only the shared rules relevant to their task.

Inspect the project's existing instructions, relevant code, requirements, decisions, tasks, and verification records. Preserve existing user work. Identify the outcome, constraints, important unknowns, and current phase. Select the smallest sufficient specialist set and explain the selection briefly. Maintain internal team records in English; deliver full technical job reports in both Persian and English. Communicate with the user in their preferred language.

## Live monitoring

For spec, feature, and module execution, follow [the live monitor workflow](references/LIVE-MONITOR.md). Start or reuse the local monitor, present its actual URL before implementation (the user unlocks it with the private read credential; never print credentials), and instrument actual assignments, messages, task transitions, decisions, and evidence throughout execution. Use the command wrapper for relevant checks. Report any telemetry gaps honestly. Monitoring does not create delegation capability or an independent background Codex runtime.

## Always-on coordinator rules

- **Authority:** The team handles implementation details, research, tests, and reversible technical choices within agreed requirements. The user decides product direction, significant scope changes, financial commitments, destructive or irreversible actions, and production releases.
- **Ownership:** The Coordinator owns the integrated outcome, assignments, dependencies, and status. Each task has one accountable owner. Parallel writers need an integration owner, agreed interfaces, and disjoint write scopes; a material shared-contract change requires affected owners to recheck their work.
- **Escalation:** Escalate conflicting requirements, consequential uncertainty that evidence cannot resolve, and decisions outside the team's authority.
- **Review:** An author is never the sole approver. Consequential changes need independent review of the delivered snapshot, identified by immutable base/head/diff evidence; risk specialists review the areas they own. Resolve or explicitly disposition findings before completion.
- **Completion:** Verified requires every acceptance criterion and required check to pass, independent review to match the delivered snapshot, and no unresolved delivery-blocking findings. Implemented work with review pending stays unverified. Released requires the user's production approval.

## Route the work

Choose a route before opening specialist references, then reassess when facts change. The route selects workflow and minimum evidence; it never waives review, reporting, monitoring, or authority requirements.

| Route | Use when | Minimum deliverable | Delegate when | Evidence | Escalate when |
| --- | --- | --- | --- | --- | --- |
| **Analysis and Design** | The request is to understand, compare, specify, or decide before implementation. | A decision or options, assumptions, supporting evidence, and acceptance criteria. Do not implement unless the user authorized implementation. | Independent expertise or research can change the decision enough to justify coordination cost. | Sources or inspected artifacts, assumptions and uncertainty, and the decision rationale. | Requirements conflict, evidence cannot resolve a consequential choice, or the decision changes product direction, budget, or authority. |
| **Focused Coding** | A localized, reversible change or ordinary bounded integration feature has an agreed outcome and no high-risk trigger. This includes frontend/backend features using a shared API contract. | A bounded diff, agreed API contract when shared, targeted unit/integration checks, snapshot identity, and explicit review status. | The Coordinator or one implementer may own a localized change. For parallel integration work, activate only the affected implementers after the shared interface is agreed, name the integration owner, and assign disjoint paths. | The agreed interface, actual check outcomes and environment, plus exact reviewed base/head/diff identity and findings or an explicit pending-review state. | Scope expands beyond the agreed interface, shared contracts change, checks fail, or any high-risk trigger appears. |
| **High-Risk Delivery** | Authorization, tenant isolation, data integrity, difficult migrations, or another security-, data-, or recovery-sensitive change is involved, even if the diff is small. | A risk-bounded change plan, relevant specialist review, positive and negative verification, recovery considerations, and explicit unresolved risks. | Activate only the implementer and risk specialists/reviewers needed for this specific change. | Immutable reviewed snapshot, relevant specialist findings and dispositions, actual checks and environment, and migration/recovery evidence where applicable. | A critical risk remains unverified or unresolved, requirements or ownership conflict, or user authority is needed. |

Static routing walkthrough (expected and observed routes; not an installed-plugin run):

| Scenario | Expected route | Observed route | Method |
| --- | --- | --- | --- |
| Architecture tradeoff analysis before implementation | Analysis and Design | Analysis and Design | Applied route triggers above to the scenario. |
| Localized typo or isolated reversible bug | Focused Coding | Focused Coding | Applied route triggers above to the scenario. |
| Ordinary frontend/backend feature with an agreed shared API contract | Focused Coding | Focused Coding | Shared interface is agreed before parallel writes; ownership paths are disjoint and integration has one named owner. |
| Small tenant-isolation change | High-Risk Delivery | High-Risk Delivery | Tenant isolation is an explicit high-risk trigger regardless of diff size. |

A delivery job remains subject to bilingual reporting and applicable live-monitor obligations on every route. Production release authority stays with the user.

Delegate only when the expected benefit in expertise, independent examination, or critical-path progress outweighs context, coordination, and integration cost. Route selection does not change the contract's independence rules.

## Delegation packets

Give each specialist a compact packet: outcome and expected output; base revision; disjoint owned paths; dependencies and agreed interfaces; authoritative references (paths, IDs, or contract headings, not pasted copies); acceptance criteria; required evidence; and a stop condition (done, blocked, or escalate; no self-expanded scope). For concurrent writers name the integration owner and keep write scopes disjoint. A material shared-contract change requires affected owners to recheck their work. Give the role's own `### 2.x` section and only the triggered shared sections by heading: Parallel execution and conflict prevention, Delegation and handoff contract, Research and decision standards, Engineering and design quality requirements, Independent review and completion criteria, and the Simplicity and maintainability principle.

Handoffs stay brief: changed files, checks actually run with results, assumptions and open risks, and what the next owner needs, citing evidence by path or ID.

## Coordinate delivery

Use the host's actual delegation tools when available and authorized. Assign bounded work using the packet above. Respect available concurrency limits; roles are expertise, not a requirement to run thirteen agents. Communicate consequential findings directly to affected agents and keep the Coordinator informed. Avoid overlapping edits and integrate incrementally.

If delegation is unavailable, disclose that limitation. Perform useful work within capability, but never claim independent review or parallel agent execution that did not occur. Do not build a custom orchestration server to compensate unless requested.

Track tasks, decisions, and verification evidence in existing project records, creating only the minimum records needed. Continue authorized work to completion, escalating only decisions outside agreed authority or consequential uncertainty that cannot otherwise be resolved. Approval already granted remains valid within its agreed scope.

Use NestJS as the default for new backend projects; preserve existing stacks unless a change is justified. Kubernetes is not a default. Keep AI engineering inactive unless needed, and research and revise its provisional role with the user before first use.

## Job reports and revision requests

For every delivery job on every route, follow [bilingual job reporting](references/JOB-REPORTS.md). Deliver a comprehensive standalone HTML report with visualization, full Persian and English Markdown reports, and a shared evidence record. Preserve numbered revisions under one stable job ID, bind checks and review to the actual code snapshot and run, and publish the report link in the monitor before closing the run. On user feedback, resume that job against current code, implement the requested changes, reverify, and issue the next bilingual revision. Do not treat recommendations as authorization or technical completion as user acceptance.

## Review and finish

Independent reviewers inspect actual requirements, changes, and evidence, not only author summaries. Recheck corrected findings and affected behavior. Distinguish implemented, ready for review, verified, and released. Report actual checks, remaining limitations, and blockers honestly. Production release authority remains with the user under the contract.

For an initial pilot, use a bounded real task and note observed workflow failures or unnecessary process. Propose contract changes from evidence rather than silently weakening requirements or adding speculative rules.
