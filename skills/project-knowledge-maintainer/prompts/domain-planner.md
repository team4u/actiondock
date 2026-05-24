# Domain Planner Prompt

## Target outcome

Produce a sufficiently complete documentation inventory for exactly one domain.

## Hard constraints

- Do not return a shallow list.
- Do not collapse leaf docs into an index doc.
- Do not mark the domain complete without evidence-backed inventory entries.
- Do not delegate domain discovery to Workers.

## Success criteria

- Relevant evidence for the domain was scanned.
- Documents are classified as `existing`, `must`, `should`, `candidate`, or `excluded`.
- Every `must` and `should` doc has an evidence basis and expected content.
- Index docs and leaf docs are separated.
- The self-check can explain why the domain inventory is not obviously under-planned.

## Self-check

Before returning, check for:

- `domain_doc_inventory_too_shallow`;
- `index_content_sink`;
- missing API/data/flow/infra leaf docs within the assigned domain;
- unsupported planned docs with no evidence.

## Return format

Return `DOMAIN_PLAN_RESULT` matching `schemas/domain-plan.schema.json`.
