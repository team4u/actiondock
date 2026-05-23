# Planner: Plan A and Plan B

Planner is responsible for complete structure planning. Worker is responsible for executing assigned targets.

## Plan A

When `document_set_plan_required=true`, Planner must produce Plan A: the complete expected document set.

Plan A must include all known or reasonably expected documents categorized as:

- `existing`: already exists and should be preserved, updated, moved, or validated
- `must`: required for the current knowledge base to be complete
- `should`: strongly recommended but may be deferred if scope is constrained
- `candidate`: plausible but needs additional evidence
- `defer`: intentionally delayed, with reason
- `excluded`: considered but out of scope, with reason

For each planned document include:

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

Plan A should be over-complete rather than under-complete. It is acceptable to include `candidate`, `defer`, or `excluded` entries. It is not acceptable to omit obvious required leaf docs.

Planner must not write:

- “workers will discover the remaining docs”
- “worker should decide what docs to create”
- “add files as needed” without listing expected candidates
- “TBD by worker” as a substitute for document-set coverage

## Plan B

Plan B is the execution task plan. It must be derived from Plan A.

Each Worker task must map to one planned `target_path` unless it is a scan-only or validation-only task. A Worker may propose extra tasks but may not create unplanned substantive leaf docs.

## Replan trigger

If a Worker identifies a missing document, it must return `NEEDS_REPLAN` or include `proposed_extra_tasks`. The leader must route back to Planner or Document Set Planner before any unplanned doc is created.

## Hard failures

- `planner_underplanning`
- `delegated_discovery_to_worker`
- `missing_required_leaf_doc`
- `unplanned_leaf_doc_created`
- `document_set_plan_incomplete_metadata`


## Domain Planner fan-out

When Plan A is required, the Global Planner must assign or run one Domain Planner pass per activated or plausible domain before finalizing Plan A. Domain Planner outputs are expected to be more detailed than the final merged plan; merge later, do not under-enumerate early.

A Plan A for a broad or multi-domain scope that contains only one or two target docs is invalid unless each domain plan proves the scope is genuinely that small.

Hard failures: `domain_planner_missing`, `domain_plan_result_missing`, `domain_plan_not_merged`, `domain_doc_inventory_too_shallow`.
