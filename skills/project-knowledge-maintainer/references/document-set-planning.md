# Planner: Domain-Partitioned Plan A and Plan B

Planner is responsible for complete structure planning. Worker is responsible for executing assigned targets. When Plan A is required, planning must be domain-partitioned before it is merged.

## Plan A

When `document_set_plan_required=true`, Planner must produce Plan A: the complete expected document set. Plan A must be created by merging domain-specific plans, not by a single shallow global list.

Plan A must include all known or reasonably expected documents categorized as:

- `existing`: already exists and should be preserved, updated, moved, or validated
- `must`: required for the current knowledge base to be complete
- `should`: strongly recommended but may be deferred if scope is constrained
- `candidate`: plausible but needs additional evidence
- `defer`: intentionally delayed, with reason
- `excluded`: considered but out of scope, with reason

Before listing final documents, collect or produce domain plan results as defined in `references/domain-planning.md`. For each planned document include:

- `target_path`
- `category`
- `domain`
- `reason`
- `evidence_basis`
- `expected_content`
- `dependencies`
- `phase`
- `owner_stage`

## Plan A completeness standard

Plan A should be over-complete rather than under-complete. Domain Planners should first over-enumerate likely docs inside their domain; the Global Planner should then merge and normalize. A broad request that produces only one or two documents is a hard underplanning signal unless every domain plan explicitly shows why no other docs are needed. It is acceptable to include `candidate`, `defer`, or `excluded` entries. It is not acceptable to omit obvious required leaf docs.

Planner must not write:

- “workers will discover the remaining docs”
- “worker should decide what docs to create”
- “add files as needed” without listing expected candidates
- “TBD by worker” as a substitute for document-set coverage
- “single overview covers this domain” when evidence shows multiple routes, tables, jobs, flows, tools, or runbooks

## Plan B

Plan B is the execution task plan. It must be derived from Plan A.

Each Worker task must map to one planned `target_path` unless it is a scan-only or validation-only task. Plan B may not be emitted until required Domain Planner results have been received, blocked, or explicitly unavailable. A Worker may propose extra tasks but may not create unplanned substantive leaf docs.

## Replan trigger

If a Worker identifies a missing document, it must return `NEEDS_REPLAN` or include `proposed_extra_tasks`. The leader must route back to Planner or Document Set Planner before any unplanned doc is created.

## Hard failures

- `planner_underplanning`
- `delegated_discovery_to_worker`
- `missing_required_leaf_doc`
- `unplanned_leaf_doc_created`
- `document_set_plan_incomplete_metadata`
- `domain_planner_missing`
- `domain_plan_result_missing`
- `domain_plan_not_merged`
- `domain_doc_inventory_too_shallow`
