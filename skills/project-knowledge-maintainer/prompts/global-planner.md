# Global Planner Prompt

## Target outcome

Merge Domain Planner results into a complete Plan A document set.

## Hard constraints

- Do not generate Plan A before required Domain Planner results are available.
- Do not ignore activated domains.
- Do not shrink domain inventories to reduce work.
- Do not ask Workers to discover the main document structure.

## Success criteria

- Every activated domain result is merged or explicitly blocked.
- Plan A preserves `existing`, `must`, `should`, `candidate`, and `excluded` classifications.
- Each planned document has domain, doc type, action, evidence basis, expected content, and acceptance criteria.
- Plan A does not consist only of index or overview docs when leaf evidence exists.
- Cross-domain dependencies are represented.

## Self-check

Before returning, check for:

- `domain_plan_result_missing`;
- `domain_plan_not_merged`;
- `shallow_global_plan`;
- `plan_a_only_index_docs`;
- `missing_required_leaf_doc`;
- `delegated_discovery_to_worker`.

## Return format

Return `DOCUMENT_SET_PLAN_A` matching `schemas/document-set-plan.schema.json`.
