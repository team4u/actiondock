# Domain Planner Prompt

## Target outcome

Produce a sufficiently complete documentation inventory for exactly one domain.

The output is a domain inventory, not final prose. It should be broad enough that Workers do not need to discover the main document structure later.

## Planning policy

- Prefer explicit `leaf`, `runbook`, and `reference` documents over broad index-only plans.
- Prefer over-complete `candidate` / `defer` records over silently omitting plausible documents.
- Use evidence-sensitive depth instead of a fixed document count.
- If the domain is active and leaf-level evidence exists, an index document alone is insufficient unless the reason is recorded.
- Classify execution priority clearly:
  - `existing`, `must`, `should`: normally eligible for default Plan B execution.
  - `candidate`: eligible only for high-coverage, repair, or explicit user scope.
  - `defer`, `excluded`: tracked but not executed by default.

## Hard constraints

- Do not return a shallow list.
- Do not collapse leaf docs into an index doc.
- Do not mark the domain complete without evidence-backed inventory entries.
- Do not delegate domain discovery to Workers.
- Do not suppress `should` or `candidate` documents only to keep the task list short.

## Evidence-sensitive leaf guidance

Use repository evidence to decide granularity:

- API routes/controllers/clients normally require endpoint or bounded-context leaf docs, plus auth/errors/webhooks when evidenced.
- Data models/migrations/schemas normally require table/entity/lifecycle leaf docs.
- Business processes/jobs/events/state machines normally require flow/state/edge-case leaf docs.
- Infra/config/deploy/env evidence normally requires env/config/local-dev/deploy/runbook docs where applicable.
- Agent/tool/prompt/workflow evidence normally requires tool contract, prompt behavior, and operational runbook docs where applicable.
- Architecture evidence normally requires system map, module boundaries, dependency, and decision records where applicable.

## Success criteria

- Relevant evidence for the domain was scanned.
- Domain entities or an evidence-backed lack of entities are identified.
- Documents are classified as `existing`, `must`, `should`, `candidate`, `defer`, or `excluded`.
- Every `must` and `should` doc has an evidence basis, expected content, and acceptance criteria.
- Plausible leaf docs with partial evidence are represented as `candidate` or `defer`, not omitted.
- Index docs and leaf docs are separated.
- The self-check can explain why the domain inventory is not obviously under-planned.

## Self-check

Before returning, check for:

- `domain_doc_inventory_too_shallow`;
- `domain_plan_too_shallow`;
- `active_domain_index_only`;
- `index_content_sink`;
- missing API/data/flow/infra/agent/architecture leaf docs within the assigned domain;
- unsupported planned docs with no evidence.

## Return format

Return `DOMAIN_PLAN_RESULT` matching `schemas/domain-plan.schema.json`.
