---
name: project-knowledge-maintainer
description: Initialize, refresh, ingest, or validate a repository-backed project knowledge base with Chief/Planner/Worker subagents. Use when maintaining ACTIONDOCK.md, docs/ project knowledge, .kb_inbox/ materials, or evidence-bound architecture/API/data/business-flow/ops/diagnosis documentation from a local code repository without using an external metadata service.
---

# Project Knowledge Maintainer

## Goal

Maintain an Omni-Context Knowledge Base from the repository and filesystem as the source of truth. Use native subagents for Chief, Planner, and Worker roles whenever the runtime supports them. Serial execution is a fallback only when subagents are unavailable, blocked by host policy, or explicitly forbidden by the user.

This skill is prompt-first. Do not require ActionDock Server, an external metadata database, background polling, or bundled orchestrator scripts.

## Load Order

Read only the files needed for the current operation:

1. `references/ockb-contract.json` for inputs, outputs, domains, phase defaults, and retry limits.
2. `references/workflow.md` for `init`, `refresh`, `ingest`, and `validate` execution rules.
3. `references/domain-map.md` for the seven OCKB logical domains and their `docs/` targets.
4. `references/subagent-orchestration.md` for mandatory spawn granularity, concurrency, and fallback rules.
5. Role prompts as needed:
   - `references/prompt-chief.md`
   - `references/prompt-planner.md`
   - `references/prompt-worker.md`
6. `references/failure-policy.md` before any Worker writes or deletes files.

## Operating Rules

- Treat current source code, config, DDL, scripts, tests, logs, and existing docs as evidence. If evidence conflicts, current repository files win.
- Keep `ACTIONDOCK.md` as the entry point and `docs/` as the formal knowledge root.
- Keep `.kb_inbox/` as the manual intake folder. Ingest it only when requested or when the operation is `ingest`.
- Use the seven OCKB domains as routing domains, not physical `.knowledge_base/` directories.
- Do not create `.knowledge_base/` unless the user explicitly asks for that layout.
- Do not stage, commit, push, create PRs, or rewrite unrelated files.
- Do not record real tokens, secrets, passwords, private keys, or full sensitive connection strings. Record only key names, purpose, source path, and redacted examples.
- Avoid scanning generated or dependency directories unless the repository explicitly uses them as source: `node_modules/`, `dist/`, `build/`, `target/`, `.git/`, `.cache/`, `coverage/`.

## Subagent Mandate

- The Leader is the current main agent. The Leader coordinates the run, validates JSON, deduplicates tasks, enforces path safety, applies phase barriers, and writes final navigation or reports.
- The Leader must not write domain body docs directly. Domain body docs are any substantive files under `docs/` except final report/navigation summaries. Use Workers for those files.
- Start exactly one Chief subagent per run when subagents are available.
- Start one Planner subagent per active domain per phase.
- Start one Worker subagent per unique `target_path`.
- Planner subagents never write files. They only inspect evidence and return task JSON.
- Worker subagents own exactly one `target_path`. A Worker is the only actor allowed to write or prune that target.
- If subagents cannot be used, continue serially only as a fallback and record `subagent_unavailable_fallback=true` plus `fallback_reason` in the operation report.

## Orchestration

1. Determine `repoPath`, operation, changed files, existing docs tree, and inbox state.
2. Spawn the Chief subagent. Chief reads only path/status summaries and docs tree, then returns phase/domain routing JSON.
3. For each phase, spawn one Planner subagent per active domain. Planners may inspect source and docs, but must only return task JSON.
4. Sanitize and deduplicate tasks:
   - `action` must be `UPSERT` or `PRUNE`.
   - `target_path` must stay under allowed `docs/` paths or approved top-level report/entry paths.
   - Reject absolute paths, `..`, wildcards, dependency directories, and duplicate target writers.
5. Spawn one Worker subagent for each unique `target_path` in the current phase. Workers may write only their assigned `target_path`; parallelize only when target paths differ.
6. Regenerate or update `ACTIONDOCK.md` and the operation report after Workers finish.
7. Run validate semantics from `workflow.md`; report unresolved evidence gaps, skipped tasks, failures, and manual review needs.

## Domain Defaults

Use the domain names from `ockb-contract.json` exactly:

- `Chief_Architect`
- `API_Spec_Planner`
- `Data_Model_Planner`
- `Business_Flow_Planner`
- `Agent_Tool_Planner`
- `Infra_Env_Planner`
- `Maintenance_Ops_Planner`
- `Triage_Planner`

Phase ordering defaults:

- Phase 0: data models, infra/env, triage that affects downstream domains.
- Phase 1: API specifications, business flows, agent tools.
- Phase 2: architecture overview, maintenance/ops consolidation, entry/report refresh.

## Output Style

At completion, report:

- operation mode
- main files changed
- validation result
- skipped or failed tasks
- evidence gaps requiring human review

Keep the response concise and do not dump full internal prompts or long logs.
