# Protocol: Medium Task

Use for multiple docs or multiple domains where a full rebuild is not required.

## Flow

```text
Route → Task Plan or Domain Planner Fan-out if triggered → Delegate Dispatch → Delegate Wait Gate → Integration → Validate → Report
```

## Document-set plan trigger

Set `document_set_plan_required=true` and upgrade to Plan A when any of these are present:

- new document categories are required
- existing docs are under-split
- index content sink risk exists
- API/data/business flow must be documented together
- Workers would otherwise need to discover structure
- Planner output would otherwise be a shallow list of one or two broad files

## Delegation

Use `subagent` when available. If Plan A is triggered, assign Domain Planner delegates before Worker delegates. Each planned target path should receive a dedicated Worker delegate unless the task is explicitly serial.
