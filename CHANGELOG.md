# Changelog

## 0.3.0

### Added

- Full Persian and English technical reports after each delivery job, with standalone HTML, Markdown, structured evidence, and diagrams.
- Stable job IDs and preserved numbered revisions for user feedback and continued implementation.
- Report validation, requirement/evidence mapping, explicit review/release status, and pending user acceptance.
- Job reports view in the live monitor with safe project-local report serving.
- Integration checks for bilingual output, revision preservation, report identity, escaping, and filesystem boundaries.

## 0.2.0

### Added

- Local live dashboard with agent communication map, task board, searchable activity, and evidence and decision details.
- Project-local event journal, live updates, reconnect recovery, and explicit provenance labels.
- Command wrapper capturing exit status and duration without collecting arguments or output.
- Per-project single-writer protection and fail-closed journal and stale-lock handling.
- Monitoring instructions integrated into the coordinator skill for spec, feature, and module execution.
- Integration tests and initial independent server/security and frontend/UX review.

### Limitations

- Local pilot, not a standalone autonomous agent runtime.
- Actual delegation requires host tools; monitoring covers reported events and wrapped commands.
- Fresh installed-plugin execution against a real feature spec remains to be validated.

## 0.1.0

### Added

- Initial coordinator skill and English operating contract.
- Thirteen specialist roles with phase-appropriate activation, independent review, and evidence requirements.
- NestJS preference, infrastructure simplicity rules, and user-owned production release authority.
