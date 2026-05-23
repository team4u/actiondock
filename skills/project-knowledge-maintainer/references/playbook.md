# Playbook

## Core flow

Choose the lightest protocol that can safely complete the task.

```text
XS: Route-lite → Apply → Validate-lite → Report
S:  Route-lite → Mini Plan → Apply → Validate-lite → Report
M:  Route → Task Plan → Delegate Dispatch → Delegate Wait Gate → Integration → Validate → Report
L:  Route → Workspace Scan → Noise Filter → Domain Planner Fan-out → Plan A Merge → Plan B → Delegates → Gate → Integration → Validate → Repair if needed → Report
XL: Route → Workspace Partition → Noise Filter → Domain Planner Fan-out → Plan A Merge → Phased Plan B → Delegates → Gate → Integration → Validate → Repair if needed → Report
```

## Execution priority

```text
subagent > serial
```

Use the highest available mode unless the user forbids delegation or the runtime cannot create delegates.

Serial fallback is valid only when delegation is unavailable, explicitly forbidden, rejected by the environment, or the selected XS/S protocol permits inline execution. Delegate slowness or pending status is not a fallback reason.

## Delegate wait gate

Every delegated stage must return an explicit result before dependent stages proceed.

Valid completion statuses:

- `COMPLETED`
- `FAILED`
- `BLOCKED`
- `NEEDS_REPLAN`
- `UNAVAILABLE`
- `TIMEOUT_REPORTED`

`WAITING` is an interim status, not completion.

## Domain planning, Plan A, and Plan B

When `document_set_plan_required=true`, Planner must first run domain-partitioned planning. Each activated or plausible domain receives a Domain Planner pass. The Global Planner merges domain plans into Plan A, the complete expected document set. Plan B is the executable task batch derived from Plan A.

Workers may propose extra tasks but cannot create unplanned substantive leaf docs.

## Scale triggers

Escalate from XS/S to M/L/XL when any of these appear:

- multiple knowledge domains
- multiple target docs
- index content sink risk
- under-split existing docs
- API/data/business-flow changes together
- large ingest or monorepo
- Workers would need to discover missing document structure
- a single Planner would likely collapse several domains into one or two broad docs

## Repair loop

Validator findings drive repair. Repairs must be planned, delegated when possible, waited for, and revalidated. Do not mark a finding resolved without evidence.
