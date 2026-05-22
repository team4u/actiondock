# Workflow

`references/ockb-contract.json` is the canonical contract for inputs, outputs, target task shape, validation checks, retry limits, and path safety. This file describes flow, not constants.

## Preflight

Run deterministic `preflight` before any planning or writing:

1. Resolve `operation`. If `auto`, choose `init` when `ACTIONDOCK.md` or `docs/` is missing, otherwise choose `refresh`.
2. Gather `changedFiles` from user input or Git when allowed.
3. Inspect `.kb_inbox/` and explicit `inboxPaths` when relevant.
4. Read the current `ACTIONDOCK.md`, `docs/` tree, and `docs/_meta/knowledge-map.json` when present.
5. Filter generated or dependency directories using the contract safety rules.
6. Build the initial candidate target set from:
   - changed evidence paths
   - current doc ownership from `knowledge-map`
   - existing docs that already cover the same topic
7. Choose `thin`, `standard`, or `deep`.

Profile guidance:

- `thin`: `<=5` changed files, `<=2` target docs, no root build/schema/infra trigger, and no ambiguous ownership.
- `standard`: bounded but meaningful refresh, or a few ambiguous targets.
- `deep`: wide structural change, missing ownership metadata, cross-domain impact, or `forceFullValidate=true`.

## Target Derivation

Prefer deterministic routing before asking subagents to reason.

- If `knowledge-map` already maps the evidence to a canonical `target_path`, reuse it.
- If one existing doc clearly owns the topic, plan an `update`.
- Create a new target only when the current docs cannot absorb the change without becoming a mixed-topic dump and `allowNewDocs=true`.
- If a new target is warranted but `allowNewDocs=false`, keep the nearest canonical target unchanged and report an evidence-backed gap for manual review.
- Use `prune` only when the target is narrowly owned and the evidence shows the topic is gone.

Escalate to an `Impact Analyzer` subagent only when:

- multiple existing docs plausibly own the same evidence
- a new topic may deserve a new canonical page
- stale ownership metadata conflicts with current repository structure

## Init

1. Run `preflight`.
2. Create minimal `docs/` subtrees only for evidence-backed topics.
3. Build initial `target_task` items from strong evidence first.
4. Use Planner subagents only for ambiguous or new targets.
5. Spawn one Worker per unique `target_path`.
6. Let the Leader write `docs/_meta/knowledge-map.json`, `ACTIONDOCK.md`, and the init report.

## Refresh

1. Run `preflight`.
2. Reuse `knowledge-map` ownership where possible.
3. Escalate only ambiguous targets to `Impact Analyzer` or Planner subagents.
4. Spawn Workers for the final deduplicated target set.
5. Update `ACTIONDOCK.md` only when any completed task has `nav_impact=true`.
6. Write the refresh report with updated targets, skipped targets, and evidence gaps.

## Ingest

1. Run `preflight`.
2. Classify `.kb_inbox/` or explicit inbox files:
   - troubleshooting or operations material
   - code/data/API/business-flow change intent
   - unrelated or unsafe material
3. Route pure operations material to maintenance or diagnosis docs.
4. Convert change-intent material into `target_task` items backed by repository evidence.
5. After successful absorption, let the owning Worker remove only processed inbox files.
6. Preserve unprocessed files and report why.
7. Refresh `knowledge-map`, then write the ingest report.

## Validate

Do not rewrite substantive docs unless the user explicitly asks for fixes. Check:

- `ACTIONDOCK.md` exists and links to relevant `docs/` areas.
- docs links point to existing files.
- target docs include `## Evidence and Boundaries`.
- evidence sections include sources, freshness, confidence, and scope limits.
- `knowledge-map` entries match current formal docs.
- docs do not contain duplicate ownership or orphan pages.
- known changed files have plausible doc coverage.
- inbox files are either pending or intentionally unprocessed.
- no obvious secrets are exposed in docs.

Write the validate report with pass/fail status, findings, suggested repair tasks, and subagent mode. If the user asks to fix findings, route each substantive doc change through Worker subagents.

## Finalization

After any mutating operation, summarize:

- operation
- files created, updated, pruned, or skipped
- failed Worker tasks
- subagent mode and fallback reason if any
- unresolved evidence gaps
- validation status
