# Workflow

`references/ockb-contract.json` is the canonical contract for inputs, outputs, OCKB domains, task shape, reports, retry limits, and path safety. This file describes execution flow.

## Mode Selection and Preflight

Run deterministic preflight before any planning or writing:

1. Resolve `operation`. If `auto`, choose `init` when `ACTIONDOCK.md` or `docs/` is missing, otherwise choose `refresh`. If inbox files exist and the user explicitly asks to process them, choose `ingest`.
2. Gather `changedFiles` from user input or Git when allowed.
3. Inspect `.kb_inbox/` and explicit `inboxPaths` when relevant.
4. Read the current `ACTIONDOCK.md`, `docs/` tree, and `docs/_meta/knowledge-map.json` when present.
5. Filter generated or dependency directories using the contract safety rules.
6. Build initial candidate targets from changed evidence paths, existing docs, domain defaults, and current `knowledge-map` ownership.
7. Choose a profile:
   - `standard`: default for normal init, refresh, and ingest work.
   - `deep`: broad repository initialization, cross-domain change, stale/missing ownership, schema/API/business-flow impact, repeated ambiguity, or `forceFullValidate=true`.
   - `thin`: only for obvious low-risk refreshes with `<=5` changed files, `<=2` target docs, no root build/schema/infra trigger, and no ownership ambiguity.

If unsure between `thin` and `standard`, use `standard`.

## Significance Gate

Classify every candidate before spawning Workers:

- `write`: durable knowledge changed and human docs should be updated now.
- `defer`: the change is real but minor, clearly maps to an existing owner, and does not change what future agents or engineers should do today.
- `skip`: the change is generated, cosmetic, transient, test-only, or an isolated implementation detail with no future decision value.

Write immediately when evidence changes API contracts, schema or DDL, data semantics, config semantics, deployment or runtime behavior, business rules, agent/tool usage, runbook steps, security posture, failure diagnosis, or makes an existing doc wrong.

Do not create new docs for `defer` or `skip`. Record `defer` items as capped pending evidence on the existing owner entry in `knowledge-map`; record `skip` items only in the operation report. Promote deferred items to `write` when related evidence accumulates, confidence drops, or a later material change touches the same owner.

The significance gate decides whether to write. It must not reduce the depth of a document once an `UPSERT` task exists.

## Init

1. Inspect repository structure, manifests, config, source roots, tests, scripts, data definitions, and existing docs.
2. Choose `deep` unless the repository is very small and the user asked for a minimal initialization.
3. Create minimal `docs/` subtrees only for evidence-backed topics.
4. Spawn the Chief subagent using repository path summaries and any existing docs tree.
5. Spawn one Planner subagent for each activated domain in each phase.
6. Apply the significance gate to Planner outputs; weak or transient material becomes `skip`, not placeholder docs.
7. Spawn one Worker subagent for each unique `target_path` to create evidence-bound, deep docs.
8. Let the Leader update `docs/_meta/knowledge-map.json`, `ACTIONDOCK.md`, and `KNOWLEDGE_INIT_REPORT.md`.

## Refresh

1. Build a changed-file list from user input or Git.
2. Inspect existing `ACTIONDOCK.md`, affected `docs/` pages, and relevant `knowledge-map` entries.
3. Use `thin` only when ownership and significance are obvious. Otherwise spawn the Chief from changed paths and docs tree.
4. Spawn domain Planner subagents to produce `UPSERT` or `PRUNE` tasks, plus deferred and skipped items.
5. Use Impact Analyzer only when multiple existing docs plausibly own the same evidence, a new target may be needed, or stale ownership conflicts with current source structure.
6. Sanitize and deduplicate tasks by `target_path`.
7. Spawn Workers phase by phase. Later phases may read docs written by earlier phases.
8. Let the Leader update navigation only when completed tasks have `nav_impact=true`.
9. Let the Leader update `knowledge-map` and write `KNOWLEDGE_UPDATE_REPORT.md`.

## Ingest

1. Inspect `.kb_inbox/` and user-provided `inboxPaths`.
2. Spawn `Triage_Planner` as a Planner subagent unless the inbox contains one obvious file.
3. Classify each item:
   - pure troubleshooting or operations knowledge
   - code/data/API/business-flow change intent
   - unrelated or unsafe material
4. Route pure operations material to `Maintenance_Ops_Planner` targets.
5. Convert change-intent material into candidates backed by repository evidence, then route to the appropriate domain Planner.
6. Apply the significance gate before creating write tasks.
7. After successful absorption, let the owning Worker remove or empty only processed inbox source files.
8. Preserve unprocessed, deferred, or skipped files and report why.
9. Refresh `knowledge-map`, `ACTIONDOCK.md` if navigation changed, and `KNOWLEDGE_INGEST_REPORT.md`.

## Validate

Do not rewrite substantive docs unless the user explicitly asks for fixes. The Leader may perform read-only validation directly or spawn read-only validation subagents for large repositories.

Check:

- `ACTIONDOCK.md` exists and links to relevant `docs/` areas.
- docs links point to existing files.
- substantive target docs include `## Evidence and Boundaries`.
- evidence sections include sources, freshness, confidence, scope limits, and open questions.
- docs do not cite temporary paths as final evidence.
- `knowledge-map` entries match current formal docs and do not create duplicate owners.
- deferred metadata is capped and attached only to existing owner entries.
- known changed files have plausible domain coverage.
- docs are deep enough for their kind: they explain behavior, inputs/outputs, dependencies, failure modes, and operational or implementation consequences where evidence supports them.
- inbox files are either pending or intentionally unprocessed.
- no obvious secrets are exposed in docs.
- no `.knowledge_base/` layout is required unless the user requested it.

Write `KNOWLEDGE_VALIDATE_REPORT.md` with pass/fail status, findings, suggested repair tasks, and subagent mode. If the user asks to fix findings, route each substantive doc change through Worker subagents.

## Finalization

After any mutating operation, summarize:

- operation and profile
- files created, updated, pruned, or skipped
- deferred updates and skipped low-significance items
- failed Worker tasks
- subagent mode and fallback reason if any
- unresolved evidence gaps
- validation status
