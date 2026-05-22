---
name: project-knowledge-maintainer
description: Maintain a repository-backed project knowledge base from local evidence. Use when initializing, refreshing, ingesting, or validating ACTIONDOCK.md, docs/, or .kb_inbox/ materials for a local repository with evidence-driven preflight, targeted planning, and single-target writer subagents.
---

# Project Knowledge Maintainer

## Goal

Maintain an evidence-bound project knowledge base from repository files and filesystem state.

This skill is prompt-first. Do not require ActionDock Server, an external metadata database, background polling, or bundled orchestrator scripts.

## When to Use

- `init`: the repository has no formal knowledge base yet.
- `refresh`: code, config, DDL, tests, scripts, logs, or docs changed and the knowledge base needs to be updated.
- `ingest`: `.kb_inbox/` or explicit inbox files should be absorbed into formal docs.
- `validate`: the existing knowledge base should be checked without proactively rewriting substantive docs.

## When Not to Use

- You only need to look up project knowledge or scripts. Use the searcher or CLI workflow instead.
- The target repository is unavailable locally and cannot be resolved from files.
- The task is outside repository evidence or does not touch `ACTIONDOCK.md`, `docs/`, or `.kb_inbox/`.

## Load Order

Read only the files needed for the current operation:

1. `references/ockb-contract.json` for inputs, outputs, target task schema, report fields, retry limits, and path safety.
2. `references/workflow.md` for `preflight`, `init`, `refresh`, `ingest`, and `validate` execution rules.
3. `references/knowledge-map.md` when you need the machine-owned coverage index shape or ownership rules.
4. `references/domain-map.md` for logical knowledge domains and canonical `docs/` targets.
5. `references/subagent-orchestration.md` for subagent responsibilities, concurrency, and fallback rules.
6. `references/examples.md` when you need canonical JSON shapes or smoke scenarios.
7. Role prompts as needed:
   - `references/prompt-impact-analyzer.md`
   - `references/prompt-planner.md`
   - `references/prompt-worker.md`
8. `references/failure-policy.md` before any Worker writes or deletes files.

## Operating Rules

- Treat current source code, config, DDL, scripts, tests, logs, and existing docs as evidence. If evidence conflicts, current repository files win.
- Keep `ACTIONDOCK.md` as the entry point and `docs/` as the formal knowledge root.
- Keep `.kb_inbox/` as the manual intake folder. Ingest it only when requested or when the operation is `ingest`.
- Keep machine-owned coverage metadata in `docs/_meta/knowledge-map.json`.
- Use OCKB domains as classification labels, not mandatory agent boundaries.
- Do not create `.knowledge_base/` unless the user explicitly asks for that layout.
- Do not stage, commit, push, create PRs, or rewrite unrelated files.
- Do not record real tokens, secrets, passwords, private keys, or full sensitive connection strings. Record only key names, purpose, source path, and redacted examples.
- Prefer stable, reusable, action-enabling knowledge. Skip transient implementation detail, generated noise, and one-off facts unless they change future decisions.
- Apply the significance gate before any Worker task: write material knowledge now, defer minor durable changes to existing `knowledge-map` owners, and skip noise.
- Avoid scanning generated or dependency directories unless the repository explicitly uses them as source: `node_modules/`, `dist/`, `build/`, `target/`, `.git/`, `.cache/`, `coverage/`.

## Run Profiles

Use the lightest profile that still covers the change correctly.

- `thin`: narrow surface, direct evidence, at most a couple of target files, no broad reclassification.
- `standard`: the default for bounded but meaningful refresh work.
- `deep`: structural or cross-cutting change, missing ownership metadata, or wide ambiguity that requires broader validation.

Choose the profile during `preflight` based on the repository state, not on subagent availability.

## Execution Model

1. Run deterministic `preflight` first:
   - normalize `operation`
   - collect `changedFiles` or infer them from Git when allowed
   - inspect `.kb_inbox/`
   - read current `ACTIONDOCK.md`, `docs/` tree, and `docs/_meta/knowledge-map.json` when present
   - choose `thin`, `standard`, or `deep`
2. Build candidate targets from direct evidence and existing ownership metadata.
3. Apply the significance gate and classify each candidate as `write`, `defer`, or `skip`.
4. If write-target ownership or scope is ambiguous, spawn one `Impact Analyzer` subagent. Keep it path-focused; do not let it draft docs.
5. Spawn Planner subagents only for ambiguous or new write targets. Planners return atomic `target_task` JSON and never write files.
6. Spawn one Worker subagent per unique write `target_path`. A Worker owns one file and may only use the evidence assigned to it unless retry rules explicitly widen the search.
7. Update `docs/_meta/knowledge-map.json`, `ACTIONDOCK.md`, and the operation report after Workers finish. Update `ACTIONDOCK.md` only when navigation coverage changed.
8. Run validate semantics from `workflow.md`; report unresolved evidence gaps, deferred updates, skipped tasks, failures, stale docs, and manual review needs.

## Subagent Mandate

- The Leader is the current main agent. The Leader performs `preflight`, validates JSON, deduplicates tasks, enforces path safety, updates machine metadata, and writes final navigation or reports.
- The Leader must not write substantive domain body docs directly. Domain body docs are any substantive files under `docs/` except navigation summaries, reports, and `docs/_meta/knowledge-map.json`.
- Use subagents for context control, not maximum fan-out.
- `Impact Analyzer` is optional and at most one per run.
- Planner subagents are optional and scoped to one candidate target or one tightly related target set.
- Start one Worker subagent per unique `target_path`.
- Worker subagents own exactly one `target_path`. A Worker is the only actor allowed to write or prune that target.
- If subagents cannot be used, continue serially only as a fallback and record `subagent_unavailable_fallback=true` plus `fallback_reason` in the operation report.

## Output Style

At completion, report:

- operation mode
- main files changed
- validation result
- deferred updates
- skipped or failed tasks
- evidence gaps requiring human review

Keep the response concise and do not dump full internal prompts or long logs.
