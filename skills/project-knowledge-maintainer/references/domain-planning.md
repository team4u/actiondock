# Domain Planning

When Plan A is required, planning is domain-partitioned.

```text
Global Planner
→ Domain Planner fan-out
→ Domain plan results
→ Plan A merge
→ Plan B task plan
```

## Canonical domains

- `architecture`
- `api`
- `data`
- `business_flow`
- `agent_tool`
- `infra_env`
- `maintenance_ops`
- `other`

A domain is activated when repository evidence, existing docs, inbox material, tests, configuration, migrations, routes, jobs, prompts, deployment files, or user request scope indicate durable knowledge may be needed.

## Domain Planner success criteria

A Domain Planner is complete only when it can show:

- relevant evidence was scanned;
- domain entities or lack of entities are identified;
- documents are classified as `existing`, `must`, `should`, `candidate`, `defer`, or `excluded`;
- index documents are separated from leaf documents;
- each `must` / `should` document has evidence basis;
- obvious missing leaf docs are not left to Workers;
- the self-check reports under-split and index-sink risks.

Prefer over-complete `candidate` / `defer` entries over a shallow inventory.

## Minimum depth rule

Do not enforce a fixed document count. Enforce evidence-sensitive depth.

Examples:

- API routes/controllers normally need endpoint or bounded-context leaf docs, plus auth/errors when evidenced.
- Data models/migrations normally need table/entity/lifecycle leaf docs.
- Business flows normally need flow/state/edge-case docs.
- Infra/env evidence normally needs local-dev/env/config/deploy/runbook docs where applicable.

An active domain represented only by an index file is a risk and must be justified.

## Global Planner merge

Global Planner must wait for Domain Planner results before merging Plan A.

The merge must include:

- all `must` documents from active domain plans;
- justified `should`, `candidate`, and `defer` documents;
- `excluded` entries for considered out-of-scope docs;
- cross-domain dependencies;
- de-duplication and path normalization.

Global Planner may not drop a Domain Planner `must` document without a recorded merge decision and reason.

Hard failures:

- `domain_planner_missing`
- `domain_plan_result_missing`
- `domain_doc_inventory_too_shallow`
- `domain_plan_not_merged`
- `shallow_global_plan`
