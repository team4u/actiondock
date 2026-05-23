# Protocol: XS Lite

Use for one-file, low-risk edits such as typo fixes, link fixes, tiny env note updates, and small corrections.

## Flow

```text
Route-lite → Apply → Validate-lite → Report
```

## Requirements

- Hard safety applies.
- Evidence priority applies.
- Delegation is optional unless the environment requires it.
- No Plan A required.
- No document-set plan required unless the change reveals granularity or coverage risk.

## Validate-lite

Check:

- changed path is safe
- no secret leakage
- local links affected by the change are valid
- change is supported by evidence or user instruction

Escalate to S/M if the edit touches multiple docs, multiple domains, or reveals stale structure.
