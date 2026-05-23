# Workflow

## Mode Selection

- `init`: use when `ACTIONDOCK.md` or `docs/` is missing or the user asks to initialize.
- `refresh`: use when maintaining an existing knowledge base from code changes. If `changedFiles` is absent, derive it from Git status/diff when available.
- `ingest`: use when `.kb_inbox/` or user-provided inbox paths should be absorbed into formal docs.
- `validate`: use when checking the existing knowledge base without proactively rewriting substantive docs.

If `operation` is `auto`, choose `init` when no formal knowledge base exists, otherwise choose `refresh`. If inbox files exist and the user explicitly asks to process them, choose `ingest`.

## Routing Notes

- Use `phaseDefaultsByOperation` from `ockb-contract.json` as the default routing source.
- For `refresh`, ask the Chief to route from changed paths and docs tree only.
- For `ingest`, run `Triage_Planner` first, then route change-intent material to the responsible Planner domains.
- For `validate`, run read-only validation only; do not spawn Workers unless the user explicitly asks for repair.
- Prefer data and infra updates before flows and API docs when both changed.
- Prefer business-flow docs over endpoint catalogs when source evidence shows end-to-end state or table changes.
- Prefer diagnosis/runbook docs only when evidence supports actionable steps, queries, or decision criteria.
- Use Mermaid fenced blocks for nontrivial flows or state machines when source evidence supports the flow.
- Include an evidence/boundary section in every substantive docs page. Name it `## Evidence and Boundaries` unless the repository already uses Chinese headings, in which case use `## 证据与边界`.

## Operation Docs

- `references/workflow-init.md`
- `references/workflow-refresh.md`
- `references/workflow-ingest.md`
- `references/workflow-validate.md`
