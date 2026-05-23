# Domain-Partitioned Planning

When Plan A is required, planning is not a single general-purpose pass. It is a two-level planning protocol:

```text
Global Planner
→ Domain Planner fan-out
→ Domain plan results
→ Plan A merge
→ Plan B task plan
```

## Required domain fan-out

For every activated or plausible domain, assign one Domain Planner delegate when `subagent` execution is available. If delegation is unavailable, the leader may run serial domain-planning passes, but each pass must still produce a separate domain plan result.

Canonical domains:

- `architecture`
- `api`
- `data`
- `business_flow`
- `agent_tool`
- `infra_env`
- `maintenance_ops`
- `other`

A domain is activated when repo evidence, existing docs, inbox material, tests, configuration, migrations, routes, jobs, prompts, deployment files, or user request scope indicate it may need durable knowledge.

## Domain Planner responsibility

Each Domain Planner must produce a domain document inventory before any Worker task is written.

For each domain, return:

- `domain`
- `activation_status`: `active`, `candidate`, or `excluded`
- `evidence_scanned`
- `domain_entities_found`
- `recommended_documents`
- `excluded_documents`
- `coverage_assertion`
- `thin_plan_risk`
- `open_questions`

`recommended_documents` must use the same categories as Plan A:

- `existing`
- `must`
- `should`
- `candidate`
- `defer`
- `excluded`

The Domain Planner should prefer an over-complete inventory with `candidate` and `defer` entries over a shallow plan.

## Minimum depth rule

An active domain cannot be represented only by a broad index file when evidence shows substantive entities.

Examples:

- API evidence with routes/controllers must produce endpoint or bounded-context leaf docs, plus auth/errors when evidenced.
- Data evidence with migrations/models must produce table/entity/lifecycle leaf docs, not only `docs/data/index.md`.
- Business-flow evidence must produce flow/state/edge-case leaf docs, not only `docs/flows/index.md`.
- Infra/env evidence must produce local-dev/env/config/deploy/runbook leaf docs as applicable.

Do not enforce a fixed minimum document count. Instead, check evidence complexity. A domain plan is too shallow when it fails to split clearly distinct entities, operations, routes, tables, flows, tools, or runbooks into maintainable leaf docs.

## Global Planner merge responsibility

The Global Planner must merge all domain plan results into Plan A.

The merge must include:

- all `must` documents from active domain plans
- justified `should`, `candidate`, and `defer` documents
- `excluded` entries for domains or docs considered out of scope
- cross-domain dependencies, such as API docs depending on data schemas or flows depending on API and jobs
- de-duplication of overlapping docs
- path normalization under the canonical docs structure

The Global Planner may not drop a Domain Planner's `must` document without recording a merge decision and reason.

## Prohibited shortcuts

The Planner must not:

- create only a few broad docs for a multi-domain request
- skip Domain Planner fan-out when Plan A is required
- use Worker discovery as a substitute for domain planning
- collapse active domains into one overloaded `architecture.md`, `index.md`, or `overview.md`
- finalize Plan B until domain plan results have been received or explicitly marked `UNAVAILABLE` / `BLOCKED`

## Hard failures

- `domain_planner_missing`
- `domain_plan_result_missing`
- `domain_plan_not_merged`
- `domain_doc_inventory_too_shallow`
- `planner_underplanning`
- `category_under_split`
- `delegated_discovery_to_worker`
