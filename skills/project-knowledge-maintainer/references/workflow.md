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
- `standard`: bounded but meaningful refresh, a few ambiguous targets, or a repository complex enough to benefit from domain routing.
- `deep`: wide structural change, missing ownership metadata, cross-domain impact, repeated routing ambiguity, or `forceFullValidate=true`.

## Profile Strategy

Choose the lightest profile that still preserves correctness.

- `thin`:
  - prefer direct owner reuse from `knowledge-map`
  - do not expand to full phase orchestration unless ambiguity forces it
  - skip updates that are tiny, cosmetic, generated, or otherwise not knowledge-worthy
- `standard`:
  - run one Chief to activate only the domains that matter
  - preserve phase order where downstream docs depend on upstream evidence
- `deep`:
  - run the full Chief-led phase skeleton
  - widen validation and ownership repair
  - preserve strict phase barriers

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

## Significance Gate

Classify every candidate before spawning Workers:

- `write`: durable knowledge changed and human docs should be updated now.
- `defer`: the change is real but minor, clearly belongs to an existing `knowledge-map` owner, and does not change what future agents or engineers should do today.
- `skip`: the change is generated, cosmetic, transient, test-only, or an isolated implementation detail with no future decision value.

Write immediately when evidence changes API contracts, schema or DDL, config semantics, deployment or runtime behavior, business rules, agent/tool usage, runbook steps, security posture, or makes an existing doc wrong.

Typical `skip` cases:

- generated assets, snapshots, or lockfile churn with no operational meaning
- formatting-only SQL or mapper edits
- pure test refactors with no reusable behavior knowledge
- tiny code movement that leaves existing docs fully correct

Typical `defer` cases:

- small durable naming alignment that still belongs to an existing owner page
- minor SQL helper changes that do not alter schema meaning or runtime behavior
- small supporting config clarifications that are not yet worth widening a formal page

Do not create new docs for `defer` or `skip`. Record `defer` items as capped pending evidence on the existing owner entry in `knowledge-map`; record `skip` items only in the operation report. Promote deferred items to `write` when related pending evidence accumulates, confidence drops, or a later material change touches the same owner.

## Phase Strategy

For `standard` and `deep` runs, preserve the older phased backbone:

- Phase 0: `Data`, `InfraEnv`, `Triage`
- Phase 1: `API`, `BusinessFlow`, `AgentTooling`
- Phase 2: `Architecture`, `MaintenanceOps`

Chief may activate only a subset of these domains for `standard` runs. `thin` runs may collapse phases entirely.

## Init

1. Run `preflight`.
2. Create minimal `docs/` subtrees only for evidence-backed topics.
3. Build initial candidates from strong evidence first.
4. Apply the significance gate; skip weak or transient material instead of creating placeholder docs.
5. If the run is `standard` or `deep`, spawn Chief and activate only the needed domains by phase.
6. Use Planner subagents only for active domains or new write targets that still need planning.
7. Spawn one Worker per unique write `target_path`.
8. Let the Leader write `docs/_meta/knowledge-map.json`, `ACTIONDOCK.md`, and the init report.

## Refresh

1. Run `preflight`.
2. Reuse `knowledge-map` ownership where possible.
3. Apply the significance gate.
4. If the change set is `thin` and ownership is obvious, plan directly or skip planning entirely.
5. If the change set is `standard` or `deep`, spawn Chief and run active-domain Planners phase by phase.
6. Escalate only ambiguous write targets to `Impact Analyzer`.
7. Spawn Workers for the final deduplicated write target set.
8. Update `ACTIONDOCK.md` only when any completed write task has `nav_impact=true`.
9. Write the refresh report with updated targets, deferred updates, skipped low-significance items, and evidence gaps.

## Ingest

1. Run `preflight`.
2. Classify `.kb_inbox/` or explicit inbox files:
   - troubleshooting or operations material
   - code/data/API/business-flow change intent
   - unrelated or unsafe material
3. Route pure operations material to maintenance or diagnosis docs.
4. Convert change-intent material into candidates backed by repository evidence.
5. Apply the significance gate before creating write tasks.
6. If the resulting work is broader than `thin`, run Chief and phase-aware Planners before Workers.
7. After successful absorption, let the owning Worker remove only processed inbox files.
8. Preserve unprocessed, deferred, or skipped files and report why.
9. Refresh `knowledge-map`, then write the ingest report.

## Validate

Do not rewrite substantive docs unless the user explicitly asks for fixes. Check:

- `ACTIONDOCK.md` exists and links to relevant `docs/` areas.
- docs links point to existing files.
- target docs include `## Evidence and Boundaries`.
- evidence sections include sources, freshness, confidence, and scope limits.
- `knowledge-map` entries match current formal docs.
- deferred metadata is capped and attached only to existing owner entries.
- docs do not contain duplicate ownership or orphan pages.
- known changed files have plausible doc coverage.
- inbox files are either pending or intentionally unprocessed.
- no obvious secrets are exposed in docs.

Write the validate report with pass/fail status, findings, suggested repair tasks, and subagent mode. If the user asks to fix findings, route each substantive doc change through Worker subagents.

## Finalization

After any mutating operation, summarize:

- operation
- files created, updated, pruned, or skipped
- deferred updates and skipped low-significance items
- failed Worker tasks
- subagent mode and fallback reason if any
- unresolved evidence gaps
- validation status
