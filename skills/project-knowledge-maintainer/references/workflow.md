# Workflow

`references/ockb-contract.json` is the canonical contract for inputs, outputs, domains, phase defaults, retry limits, and path safety. This file describes flow, not constants.

## Mode Selection

- `init`: use when `ACTIONDOCK.md` or `docs/` is missing or the user asks to initialize.
- `refresh`: use when maintaining an existing knowledge base from code changes. If `changedFiles` is absent, derive it from Git status/diff when available.
- `ingest`: use when `.kb_inbox/` or user-provided inbox paths should be absorbed into formal docs.
- `validate`: use when checking the existing knowledge base without proactively rewriting substantive docs.

If `operation` is `auto`, choose `init` when no formal knowledge base exists, otherwise choose `refresh`. If inbox files exist and the user explicitly asks to process them, choose `ingest`.

## Run Profile

Choose one profile before planning the run:

- `thin`: narrow surface, small or textual update, direct evidence available.
- `standard`: the default for a bounded but meaningful refresh.
- `deep`: broad cross-domain or semantic change that needs fuller coverage and validation.

Use the lightest profile that still covers the change correctly. The profile controls how many domains to activate, how much parallelism to allow, and how much validation depth to apply. Do not escalate to `deep` just because subagents are available.

## Init

1. Inspect repository structure, manifests, config, source roots, tests, scripts, and existing docs.
2. Create minimal `docs/` subtrees only for domains with evidence.
3. Spawn the Chief subagent using repository path summaries and any existing docs tree.
4. Spawn one Planner subagent for each activated domain in each phase.
5. Spawn one Worker subagent for each unique `target_path` to create evidence-bound docs.
6. Let the Leader update `ACTIONDOCK.md` and write the init report defined by the contract with created docs, skipped domains, subagent mode, and evidence gaps.

## Refresh

1. Build a changed-file list from user input or Git.
2. Inspect existing `ACTIONDOCK.md` and affected `docs/` pages.
3. Spawn the Chief subagent from changed paths and docs tree only.
4. Spawn domain Planner subagents to produce `UPSERT` or `PRUNE` tasks, sized to the selected run profile.
5. Spawn Worker subagents phase by phase. Later phases may read docs written by earlier phases.
6. Let the Leader update navigation and write the refresh report defined by the contract.

## Ingest

1. Inspect `.kb_inbox/` and user-provided `inboxPaths`.
2. Spawn `Triage_Planner` as a Planner subagent to classify each item:
   - pure troubleshooting or operations knowledge
   - code/data/API/business-flow change intent
   - unrelated or unsafe material
3. Spawn Worker subagents to archive pure operations material under `docs/ops/maintenance/` or `docs/diagnosis/`.
4. Convert change-intent material into tasks for the appropriate domain Planner subagents.
5. After successful absorption, let the responsible Worker remove or empty only the processed inbox source files. Preserve unprocessed files and report why.
6. Let the Leader write the ingest report defined by the contract.

## Validate

Do not rewrite substantive docs unless the user explicitly asks for fixes. The Leader may perform the read-only validation directly or spawn read-only validation subagents for large repositories. Check:

- `ACTIONDOCK.md` exists and links to relevant `docs/` areas.
- docs links point to existing files.
- target docs include evidence/boundary sections.
- target docs reflect a fitting depth for the change surface and are not obvious fact dumps or bloated walkthroughs.
- docs do not cite temporary paths as final evidence.
- known changed files have plausible domain coverage.
- inbox files are either pending or intentionally unprocessed.
- no obvious secrets are exposed in docs.
- no `.knowledge_base/` layout is required unless the user requested it.

Write the validate report defined by the contract with pass/fail status, findings, suggested repair tasks, and subagent mode. If the user asks to fix findings, route each substantive doc change through Worker subagents.

## Finalization

After any mutating operation, summarize:

- operation
- files created, updated, pruned, or skipped
- failed Worker tasks
- subagent mode and fallback reason if any
- unresolved evidence gaps
- validation status
