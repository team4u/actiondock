# Init Workflow

1. Inspect repository structure, manifests, config, source roots, tests, scripts, and existing docs.
2. Create minimal `docs/` subtrees only for domains with evidence.
3. Spawn the Chief subagent using repository path summaries and any existing docs tree.
4. Spawn one Planner subagent for each activated domain in each phase.
5. Spawn one Worker subagent for each unique `target_path` to create evidence-bound docs.
6. Let the Leader update `ACTIONDOCK.md` and write `KNOWLEDGE_INIT_REPORT.md` with created docs, skipped domains, subagent mode, and evidence gaps.

## Completion Criteria

The run is complete when the entry doc exists, evidence-backed domain docs exist for all activated domains, and the init report records skipped work and evidence gaps.
