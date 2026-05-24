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

Every planned document belongs to one category:

- `existing`: exists and should remain/update
- `must`: required for this scope
- `should`: useful but may be phased
- `candidate`: plausible; needs more evidence or lower priority
- `defer`: intentionally delayed
- `excluded`: considered and not in scope

## Plan A document fields

Each `existing`, `must`, `should`, and `candidate` document should include:

- `target_path`
- `domain`
- `doc_type`: `index`, `leaf`, `runbook`, `reference`, or `actiondock`
- `reason`
- `evidence_basis`
- `expected_content`
- `acceptance_criteria`
- `phase`
- `source_domain_plan`

## Plan B

Plan B converts Plan A into phases and Worker tasks. Every Worker task must map to one Plan A document. Do not create tasks that are not derived from Plan A.

Workers may propose extra tasks. Proposed extra tasks trigger replan; they are not permission to write unplanned leaf docs.
