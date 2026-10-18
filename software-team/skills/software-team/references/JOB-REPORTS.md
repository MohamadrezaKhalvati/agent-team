# Bilingual technical reports and revision loop

Apply at the end of each spec, feature, module, or explicitly assigned delivery job, including partial, blocked, or stopped work. Simple questions do not require a report package. Reports support the user's technical review and a later request to modify the same job.

## Mandatory handoff

Produce all of the following from one structured factual record:

- `report.html`: a standalone, offline-readable report containing full English and Persian articles, language links, RTL Persian layout, acceptance visualization, and a meaningful architecture or workflow diagram.
- `report.en.md` and `report.fa.md`: complete counterparts, not an English report plus a Persian summary.
- `report.json`: shared requirement/evidence IDs, code and run identity, technical/release/review status, parent revision, findings and continuation context.
- `diagram.en.svg` and `diagram.fa.svg`: language-appropriate diagram assets used by Markdown.

Store each revision at `<project>/docs/team-reports/<job-id>/r001/`, then `r002/`, etc. Use the report builder to avoid overwriting prior reports. These are reviewable deliverables, separate from private `.team-monitor/` runtime data. Keep secrets, raw private telemetry, sensitive records, and access tokens out of reports. Follow the host's permitted output locations when linking deliverables in chat.

## Report content

Populate the supplied input example with actual job information; it is a schema illustration, not evidence of work performed.

1. Outcome and scope: original objective, implemented behavior, unmet/deferred requirements and why; explicit technical, release, and independent-review status. User acceptance starts pending.
2. Implementation: changed components and repository-relative files; relevant before/after behavior; API, schema, state, side-effect, frontend/backend and infrastructure effects as applicable.
3. Architecture: actual boundaries, data/control flow and external dependencies. Mark proposed designs as proposed. Caption the visualization and explain limitations. No decorative graphs or invented performance charts.
4. Decisions: alternatives, rationale, tradeoffs, assumptions, simplicity/maintenance considerations and reassessment triggers.
5. Verification: requirement-to-evidence mapping, actual commands or inspection methods, outcomes, artifact references and environment/code snapshot. Separate passed, failed, not-run and inconclusive checks. Capture commands with the monitor wrapper where possible; do not invent reviewer identities, measurements or results.
6. Review: reviewer and scope, findings and severity, corrections and rechecks. If independent review was unavailable, say so; do not claim verified completion. An independent review claim must identify real evidence in this section.
7. Risks and limitations: known defects, unverified behavior, compatibility, security/privacy/performance/accessibility implications, debt, blockers and remaining uncertainty. Explicitly state when a topic is not applicable and why.
8. Operations: exact setup and run instructions, configuration names without secret values, migration/deployment impact, recovery and rollback boundaries where applicable. Technical completion does not authorize production deployment.
9. Next actions: prioritized recommendations, pending user decisions and concrete review questions with stable IDs. Distinguish required corrections from optional enhancements.
10. Continuation: original spec and task/decision locations, current code snapshot including uncommitted changes, parent report/run identity, changed requirements, revision delta and any invalidated prior evidence. Record enough context to resume in another chat.

Use the same stable IDs, statuses, numbers, evidence references and substantive findings in both languages. Translate narrative fully, retaining code identifiers, paths and commands literally. Review translations for technical meaning; the builder checks presence and structure, not semantic equivalence or truth. The coordinator owns content quality. Scale length to the actual job while covering every section; do not add speculative architecture merely to fill the report.

## Generate and publish

1. Inspect current Git state, acceptance criteria, actual changes, review findings and verification records. Record an accurate codeVersion; a commit alone is insufficient if relevant uncommitted changes exist. Give dirty snapshots an explicit diff or artifact reference in revisionContext.
2. Prepare input JSON based on [the example](../assets/report-input.example.json), with complete `en` and `fa` narrative. For later revisions set `parent.revision` and `parent.runId` to the actual prior report. Do not mutate earlier report files.
3. Run:

```text
node <skill-directory>/scripts/reports/report.mjs --input <prepared-input.json> --project <absolute-project>
```

4. Open the HTML and inspect both languages, diagram, overflow, evidence, and continuation instructions. Check full-content alignment, not merely that both headings exist. Correct the input before publication; if an immutable generated revision needs correction, issue a new revision rather than silently overwriting it.
5. After successful generation and content review, emit a `report.ready` monitor event with the same runId, a concise title/summary, and the generated `/reports/<job-id>/r001/report.html` path. The monitor verifies that files exist and run identity matches. Reports appear in **Job reports**, including links to both Markdown versions.
6. Record final task states and `run.finished` only after report handoff. In the final reply, link the HTML, Persian and English files, monitor URL, remaining blockers and how to request revisions. Keep the chat summary concise; the files hold the comprehensive report.

The report is an immutable snapshot, not a live promise: later code changes can invalidate its evidence. A verified technical status requires independent review and all listed acceptance criteria met; partial or blocked work must remain labeled accurately. User acceptance and production approval remain separate.

## Apply user feedback to the same job

When the user asks to modify the delivered job:

- Read the referenced report and actual current code; preserve unrelated user changes. If several jobs could match, resolve the ambiguity before dependent edits.
- Keep the same jobId, create a new runId and increment the report revision. Retain prior reports and reference the actual parent. Link the run's initial summary to the parent report.
- Convert feedback into traceable change requests with IDs, impacted requirements, scope and acceptance criteria. The user's requested change authorizes work within existing boundaries; do not request redundant approval for routine implementation.
- Reopen affected tasks and activate only the specialists needed. Revalidate old assumptions against current code and retest affected behavior. Do not count historical tests as executed for the new snapshot.
- Deliver a new full bilingual report including the delta, resolved and remaining findings, regression evidence and updated continuation context. Recommendations in a report alone do not authorize scope expansion.
