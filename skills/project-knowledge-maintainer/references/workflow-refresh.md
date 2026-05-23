# Refresh Workflow

1. Build a changed-file list from user input or Git.
2. Inspect existing `ACTIONDOCK.md` and affected `docs/` pages.
3. Spawn the Chief subagent from changed paths and docs tree only.
4. Spawn domain Planner subagents to produce `UPSERT` or `PRUNE` tasks.
5. Spawn Worker subagents phase by phase. Later phases may read docs written by earlier phases.
6. Let the Leader update navigation and write `KNOWLEDGE_UPDATE_REPORT.md`.

## Completion Criteria

The run is complete when changed evidence has been reflected in the formal docs, stale docs have been pruned if needed, and the update report records what changed or could not be reconciled.
