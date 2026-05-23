# Validate Workflow

Do not rewrite substantive docs unless the user explicitly asks for fixes. The Leader may perform the read-only validation directly or spawn read-only validation subagents for large repositories. Check:

- `ACTIONDOCK.md` exists and links to relevant `docs/` areas.
- docs links point to existing files.
- target docs include evidence/boundary sections.
- docs do not cite temporary paths as final evidence.
- known changed files have plausible domain coverage.
- inbox files are either pending or intentionally unprocessed.
- no obvious secrets are exposed in docs.
- no `.knowledge_base/` layout is required unless the user requested it.

Write `KNOWLEDGE_VALIDATE_REPORT.md` with pass/fail status, findings, suggested repair tasks, and subagent mode.

## Completion Criteria

The run is complete when validation findings are recorded and the knowledge base state is either accepted or clearly marked for repair.
