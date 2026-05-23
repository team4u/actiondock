# Ingest Workflow

1. Inspect `.kb_inbox/` and user-provided `inboxPaths`.
2. Spawn `Triage_Planner` to classify each item:
   - pure troubleshooting or operations knowledge
   - code/data/API/business-flow change intent
   - unrelated or unsafe material
3. Spawn Worker subagents to archive pure operations material under `docs/ops/maintenance/` or `docs/diagnosis/`.
4. Convert change-intent material into tasks for the appropriate domain Planner subagents.
5. After successful absorption, let the responsible Worker remove or empty only the processed inbox source files. Preserve unprocessed files and report why.
6. Let the Leader write `KNOWLEDGE_INGEST_REPORT.md`.

## Completion Criteria

The run is complete when inbox items have been either absorbed, preserved with a reason, or explicitly rejected, and the ingest report explains the outcome.
