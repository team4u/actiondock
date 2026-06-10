# Document Set Planning

Plan A is the complete expected document set. Plan B is the executable batch derived from Plan A.

## When Plan A is required

Plan A is required for L/XL tasks and when any of these are true:

- `document_set_plan_required=true`
- multi-domain update
- repository-wide refresh or reconstruction
- large ingest
- index content sink risk
- category under-split risk
- Worker would otherwise need to discover the main document structure

## Plan A categories

Every considered document belongs to one category:

- `existing`: exists and should remain/update.
- `must`: required for this scope.
- `should`: useful and normally executed by default.
- `candidate`: plausible; evidence-backed enough to track, but lower priority or needing high-coverage scope.
- `defer`: intentionally delayed.
- `excluded`: considered and not in scope.

The purpose of categories is scheduling, not hiding. A document that is plausible but not yet mandatory should become `candidate` or `defer`, not disappear from planning.

## Plan A document fields

Each `existing`, `must`, `should`, and `candidate` document should include:

- `target_path`
- `domain`
- `category`
- `doc_type`: `index`, `leaf`, `runbook`, `reference`, or `actiondock`
- `reason`
- `evidence_basis`
- `expected_content`
- `acceptance_criteria`
- `phase`
- `dependencies` when ordering matters
- `execution_eligibility`
- `source_domain_plan`

## Preserving merge rule

Plan A should preserve domain breadth. The Global Planner may normalize paths, dedupe duplicates, merge true duplicates, assign phases, and record dependencies. It must not reduce document count simply to make execution smaller.

Merge decisions must be recorded when a domain-planned document is:

- renamed;
- deduped;
- merged into another target;
- deferred;
- excluded;
- blocked by insufficient evidence.

A merge is valid only when the final target preserves the expected content and acceptance criteria of merged source entries.

## Execution scope

Default Plan B should execute:

- `existing`
- `must`
- `should`

High-coverage / repair Plan B may also execute evidenced `candidate` documents.

Do not execute `defer` or `excluded` entries unless a new Plan A reclassifies them.

## Plan B

Plan B converts Plan A into phases and Worker tasks. Every Worker task must map to one Plan A document. Do not create tasks that are not derived from Plan A.

Workers may propose extra tasks. Proposed extra tasks trigger replan; they are not permission to write unplanned leaf docs.

## Failure signals

- `global_planner_compressed_inventory`: Plan A drops or collapses domain inventory to reduce work.
- `should_doc_dropped_without_reason`: a Domain Planner `should` document is absent from Plan A without merge decision.
- `active_domain_index_only`: active domain has only index docs despite leaf-level evidence.
- `plan_b_skipped_should_without_reason`: Plan B skips `should` docs in default scope without explicit block/skip reason.
- `candidate_executed_without_high_coverage_scope`: Plan B schedules candidates while running in default mode.
