# Protocol: Repair Loop

Use when Validator reports hard failures or important non-hard findings.

## Flow

```text
Validation Findings → Repair Plan → Repair Delegates → Delegate Wait Gate → Re-validate → Report
```

## Repair plan

For each finding include:

- finding id
- severity
- affected paths
- required repair action
- assigned delegate
- acceptance criteria

## Repair constraints

- Do not mark resolved without evidence.
- Do not let Leader repair a delegated finding while Repair delegate is pending.
- If repair requires new docs not in Plan A, route back to Planner.
- Re-run Validator after repair.
