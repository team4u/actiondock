# Domain Planning

When Plan A is required, planning is domain-partitioned.

```text
Scope Scanner
→ Domain Planner fan-out
→ Domain plan inventories
→ Global Plan A preserving merge
→ Plan A validation
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

## Domain Planner role

Domain Planner owns document discovery inside one domain. It should return an inventory that is useful even before final execution scheduling.

The inventory may include documents that are not immediately executed. Use category to express priority instead of omitting work:

- `existing`: already exists and should remain/update.
- `must`: required for this scope.
- `should`: useful and normally executed by default.
- `candidate`: plausible and evidence-backed enough to track, but optional unless high-coverage / repair scope is active.
- `defer`: intentionally delayed.
- `excluded`: considered and out of scope.

## Domain Planner success criteria

A Domain Planner is complete only when it can show:

- relevant evidence was scanned;
- domain entities or lack of entities are identified;
- documents are classified as `existing`, `must`, `should`, `candidate`, `defer`, or `excluded`;
- index documents are separated from leaf documents;
- each `must` / `should` document has evidence basis;
- plausible leaf documents are represented as `candidate` / `defer` rather than hidden;
- obvious missing leaf docs are not left to Workers;
- the self-check reports under-split and index-sink risks.

Prefer over-complete `candidate` / `defer` entries over a shallow inventory.

## Minimum depth rule

Do not enforce a fixed document count. Enforce evidence-sensitive depth.

Examples:

- API routes/controllers normally need endpoint or bounded-context leaf docs, plus auth/errors/webhooks when evidenced.
- Data models/migrations normally need table/entity/lifecycle leaf docs.
- Business flows normally need flow/state/edge-case docs.
- Infra/env evidence normally needs local-dev/env/config/deploy/runbook docs where applicable.
- Agent/tool/prompt evidence normally needs tool contract, prompt behavior, runtime limits, and operational runbook docs where applicable.
- Architecture evidence normally needs system map, module boundaries, dependency, and decision docs where applicable.

An active domain represented only by an index file is a risk and must be justified. If leaf-level evidence exists and only index docs are planned, Validator should raise `active_domain_index_only` or `plan_a_only_index_docs`.

## Global Planner preserving merge

Global Planner must wait for Domain Planner results before merging Plan A.

The merge must include:

- all `existing` documents from active domain plans;
- all `must` documents from active domain plans;
- all `should` documents unless a recorded merge decision explains duplicate coverage, path normalization, explicit deferral, or blocked evidence;
- evidenced `candidate` documents, even if they are not scheduled in default execution;
- `defer` and `excluded` entries for considered out-of-scope docs;
- cross-domain dependencies;
- de-duplication and path normalization.

Global Planner may not drop a Domain Planner `must` or `should` document without a recorded merge decision and reason.

Global Planner may merge documents only when the resulting document preserves expected content and acceptance criteria from every merged source.

## Worker boundary

Workers execute planned `target_path` entries. Workers may propose extra tasks when evidence reveals a missing document, but that proposal triggers replan. It is not permission to create an unplanned leaf doc.

Hard failures:

- `domain_planner_missing`
- `domain_plan_result_missing`
- `domain_doc_inventory_too_shallow`
- `domain_plan_not_merged`
- `global_planner_compressed_inventory`
- `should_doc_dropped_without_reason`
- `shallow_global_plan`
- `active_domain_index_only`
