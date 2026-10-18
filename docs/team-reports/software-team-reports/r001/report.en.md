# Software Team 0.3.0 — bilingual technical reporting

Implemented full English/Persian report packages, visualizations, safe monitor links and preserved revision continuity. Automated and independent structural checks passed. This first report is the browser-validation handoff; final visual checks remain pending.

software-team-reports / r001 / reports-v3 / 2026-10-18T10:44:42.563Z

> User acceptance is pending. Technical completion is not approval to release.

- Technical status: implemented
- Release: not-released
- Review: independent
- Code snapshot: cdf16c852ac4a5b556a79aa70717fb53d3482e36
- Uncommitted changes: false

## Requirements & acceptance

- **REQ-1** — Generate full Persian and English technical reports and diagrams. — met — CHECK-TESTS, CHECK-REVIEW
- **REQ-2** — Preserve prior reports and link a new revision to its parent with a fresh run. — met — CHECK-TESTS
- **REQ-3** — Expose valid report links in the live dashboard and verify browser presentation. — partial — CHECK-TESTS, CHECK-BROWSER
- **REQ-4** — Specify comprehensive evidence-based content and a user-feedback continuation workflow. — met — CHECK-REVIEW

## Architecture / workflow · current

![Architecture / workflow](diagram.en.svg)

Implemented reporting flow: one shared record creates a preserved bilingual package, which the live monitor exposes for review.

## Implementation & changed files

Added scripts/reports/report.mjs, report.test.mjs, assets/report-input.example.json and references/JOB-REPORTS.md. Updated the coordinator skill, operating contract, monitor server/UI, manifests, README and changelog. A completed delivery now includes HTML, two Markdown files, a shared JSON record and two SVG diagrams. No changes were made to an application business backend.

## Architecture & data flow

The coordinator prepares one bilingual structured record. The dependency-free Node builder validates IDs, status, evidence references and parent identity, then writes a new revision atomically. The monitor publishes only complete report packages whose identity matches the run. Its allowlisted report routes remain inside the project report root. The HTML is standalone, script-free and contains both languages, acceptance meters and inline SVG; Markdown uses local SVG assets.

## Decisions & tradeoffs

DEC-1: use one factual record with bilingual narrative to preserve IDs, statuses and references across languages. DEC-2: keep prior revisions instead of overwriting them, accepting some duplicated narrative for review traceability. DEC-3: use a small local renderer and SVG rather than a server dependency or chart framework. DEC-4: keep user acceptance pending and distinguish technical completion, independent review and release. Validation does not establish factual truth or semantic translation equivalence.

## Independent review & corrections

Reviewer: monitor_review. Three P2 findings were corrected: an escaping docs symlink caused directory creation before rejection; incomplete packages could be published; a new revision could reuse its parent run. Added regression coverage and obtained an independent retest with no remaining blockers in the reviewed paths. Coordinator still owns narrative accuracy and browser checks.

## Risks, gaps & unverified behavior

RISK-1: a fresh feature executed through the updated installed plugin has not yet been tested; local source and package checks do not prove future host compliance. RISK-2: the renderer cannot validate factual truth or translation semantics. RISK-3: the monitor retains full history in memory and is scoped to bounded local runs. RISK-4: browser and full accessibility verification remain pending in this revision. No application database migration or production infrastructure change is involved.

## Run, deploy & recover

Requires Node.js 20+; no npm installation. Start scripts/monitor/monitor.mjs with --project and --port. Generate reports using scripts/reports/report.mjs --input <input.json> --project <project>. Outputs go to docs/team-reports/<job>/rNNN. Preserve existing revisions; publish report.ready only after content review. Stop/restart the monitor gracefully to load server changes and retain events.jsonl. No production release is performed by this report.

## Recommendations & next actions

ACTION-1: finish actual browser checks and issue a new report revision with their outcomes. ACTION-2: package and save the private 0.3.0 plugin, then verify saved files. ACTION-3: user reviews the report and supplies requested changes by requirement/finding ID. Optional follow-up: validate one real feature through a fresh installed-plugin chat; this is not silently included in the current job.

## Revision history & continuation context

First report revision for the requested 0.3.0 reporting feature. Source snapshot is commit cdf16c852ac4a5b556a79aa70717fb53d3482e36. Request and acceptance context are in the current user conversation; reusable rules are in OPERATING-CONTRACT.md section 8.1 and JOB-REPORTS.md. Next revision must use a fresh run, reference reports-v3 as parent and preserve this report.

## Verification evidence

Evidence is supplied by the team. Rendering this report does not independently verify its claims.

- **CHECK-TESTS** — Sixteen automated integration checks passed — passed
  - Executed Node tests for the monitor and report builder; independent reviewer reran the same suite and confirmed 16/16 passing.
  - node --test software-team/skills/software-team/scripts/monitor/monitor.test.mjs software-team/skills/software-team/scripts/reports/report.test.mjs
- **CHECK-REVIEW** — Independent structural/security review and retest — passed
  - monitor_review inspected the actual changes and independently reproduced and retested fixes for directory confinement before mutation, complete-package publication, and distinct parent/current run identities. Browser rendering and semantic translation were outside that review.
  - Independent reviewer handoff for version 0.3.0; regression cases in report.test.mjs and monitor.test.mjs
- **CHECK-BROWSER** — Actual browser verification — not-run
  - Pending: open this report, inspect full English and RTL Persian content, diagram and dashboard links, and check mobile layout.
  - Pending browser checks for this report revision

## Request the next revision

Continue job software-team-reports from report r001. My requested changes: [item IDs and desired changes]. Inspect the current code and this report, identify impacts and acceptance criteria, then implement and review within agreed authority. Preserve the previous report and create the next revision in Persian and English.
