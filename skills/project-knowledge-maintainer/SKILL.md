---
name: project-knowledge-maintainer
description: Initialize, refresh, ingest, or validate a repository-backed Omni-Context Knowledge Base with evidence-bound ACTIONDOCK.md/docs output, Chief/Planner/Worker subagents, deep technical documentation standards, optional knowledge-map ownership tracking, significance-gated updates, and safe .kb_inbox absorption.
---

# Project Knowledge Maintainer

## Goal

Maintain an Omni-Context Knowledge Base from the repository and filesystem as the source of truth.

The default execution model is the older OCKB backbone:

- Chief routes the run and phase order.
- Domain Planners inspect evidence and decide what formal docs should change.
- Workers converge one physical target at a time and produce deep, reusable technical documentation.

Use the current version's useful controls without weakening the backbone: `knowledge-map` ownership memory, `write/defer/skip` significance gating, optional Impact Analyzer routing, bounded profiles, and deterministic validation.

This skill is prompt-first. Do not require ActionDock Server, an external metadata database, background polling, or bundled orchestrator scripts.

## When to Use

- `init`: the repository has no formal knowledge base yet, or the user asks to initialize it.
- `refresh`: code, config, DDL, tests, scripts, logs, or docs changed and the knowledge base should be maintained.
- `ingest`: `.kb_inbox/` or explicit inbox files should be absorbed into formal docs.
- `validate`: the existing knowledge base should be checked without proactively rewriting substantive docs.

## When Not to Use

- You only need to look up existing project knowledge or scripts.
- The target repository is unavailable locally and cannot be resolved from files.
- The task is outside repository evidence or does not touch `ACTIONDOCK.md`, `docs/`, `.kb_inbox/`, or knowledge maintenance reports.

## Load Order

Read only the files needed for the current operation:

1. `references/ockb-contract.json` for inputs, outputs, OCKB domains, profiles, target task schema, report fields, retry limits, and path safety.
2. `references/workflow.md` for `init`, `refresh`, `ingest`, `validate`, preflight, significance gating, and phase rules.
3. `references/domain-map.md` for OCKB logical domains, canonical `docs/` targets, and SQL/data routing.
4. `references/knowledge-map.md` when `docs/_meta/knowledge-map.json` exists or ownership is needed.
5. `references/subagent-orchestration.md` for role boundaries, spawn granularity, phase barriers, concurrency, and fallback rules.
6. `references/examples.md` when you need canonical JSON shapes, deep-documentation smoke scenarios, or report examples.
7. Role prompts as needed:
   - `references/prompt-chief.md`
   - `references/prompt-impact-analyzer.md`
   - `references/prompt-planner.md`
   - `references/prompt-worker.md`
8. `references/failure-policy.md` before any Worker writes or deletes files.

## Operating Rules

- Treat current source code, config, DDL, scripts, tests, logs, and existing docs as evidence. If evidence conflicts, current repository files win.
- Keep `ACTIONDOCK.md` as the entry point and `docs/` as the formal knowledge root.
- Keep `.kb_inbox/` as the manual intake folder. Ingest it only when requested or when the operation is `ingest`.
- Keep machine-owned coverage metadata in `docs/_meta/knowledge-map.json`.
- Use OCKB domains as routing domains for Chief and Planner work, but keep final ownership at the document target level.
- Do not create `.knowledge_base/` unless the user explicitly asks for that layout.
- Do not stage, commit, push, create PRs, or rewrite unrelated files.
- Do not record real tokens, secrets, passwords, private keys, or full sensitive connection strings. Record only key names, purpose, source path, and redacted examples.
- Prefer stable, reusable, action-enabling knowledge over changelog prose.
- Do not update the knowledge base just because code changed. Update it when the change improves future understanding, decisions, operations, debugging, or implementation safety.
- Avoid scanning generated or dependency directories unless the repository explicitly uses them as source: `node_modules/`, `dist/`, `build/`, `target/`, `.git/`, `.cache/`, `coverage/`.

## Run Profiles

Use profiles to control fan-out, not documentation depth.

- `standard`: default for normal refresh, init, and ingest work. Run Chief, active-domain Planners, and Workers phase by phase.
- `deep`: use for initialization, broad refactors, missing/stale ownership metadata, schema/API/business-flow impact, or wide ambiguity. Preserve full phase barriers and broaden validation.
- `thin`: use only for explicit, narrow refresh work where ownership is obvious and the change is either non-material or maps to at most two known target files. If a `thin` run emits an `UPSERT`, the Worker must still produce deep documentation.

Choose the profile during preflight based on repository complexity and change scope, not on subagent availability. If unsure between `thin` and `standard`, use `standard`.

## Execution Model

1. Run deterministic preflight:
   - normalize `operation`
   - collect `changedFiles` or infer them from Git when allowed
   - inspect `.kb_inbox/`
   - read current `ACTIONDOCK.md`, `docs/` tree, and `docs/_meta/knowledge-map.json` when present
   - choose `standard`, `deep`, or narrowly justified `thin`
2. Build candidate targets from direct evidence, existing docs, domain defaults, and ownership metadata.
3. Apply the significance gate:
   - `write`: durable knowledge changed and formal docs should change now
   - `defer`: real but minor durable evidence should be retained on an existing owner entry
   - `skip`: generated, cosmetic, transient, test-only, or otherwise not useful to formal docs
4. Route by profile:
   - `thin`: use direct ownership only when obvious; otherwise escalate to `standard`
   - `standard`: spawn one Chief, then active-domain Planners phase by phase
   - `deep`: spawn one Chief, preserve all relevant phase barriers, widen validation, and repair ownership metadata
5. If write-target ownership or page scope is still ambiguous, spawn one Impact Analyzer. Keep it path-focused; it must not draft docs.
6. Spawn Planner subagents for active domains. Planners inspect evidence deeply enough to assign safe Worker tasks; they never write files.
7. Spawn one Worker per unique `target_path`. A Worker owns one file and must read enough assigned evidence to write a useful, durable doc.
8. Update `docs/_meta/knowledge-map.json`, `ACTIONDOCK.md`, and the operation report after Workers finish. Update `ACTIONDOCK.md` only when navigation coverage changed.
9. Run validate semantics from `workflow.md`; report unresolved evidence gaps, deferred updates, skipped tasks, failures, stale docs, and manual review needs.

## Subagent Mandate

- The Leader is the current main agent. The Leader performs preflight, selects the run profile, validates JSON, deduplicates tasks, enforces path safety, updates machine metadata, and writes final navigation or reports.
- The Leader must not write substantive domain body docs directly. Domain body docs are any substantive files under `docs/` except navigation summaries, reports, and `docs/_meta/knowledge-map.json`.
- Use subagents for role separation and context control, not maximum fan-out.
- `Chief` is required for `standard` and `deep` runs. Skip it only when `thin` routing is obviously safe.
- `Impact Analyzer` is optional and at most one per run.
- Planner subagents are phase-aware in `standard` and `deep` runs; in `thin` runs they may be skipped only when ownership and significance are obvious.
- Worker subagents own exactly one `target_path`. A Worker is the only actor allowed to write or prune that target.
- If subagents cannot be used, continue serially only as a fallback and record `subagent_unavailable_fallback=true` plus `fallback_reason` in the operation report.

## Output Style

At completion, report:

- operation mode and selected profile
- main files changed
- validation result
- deferred updates
- skipped or failed tasks
- evidence gaps requiring human review

Keep the response concise and do not dump full internal prompts or long logs.
