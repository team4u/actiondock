# Repair Loop

Repair is driven by Validator findings.

Flow:

```text
Validator FAIL
→ Repair Planner classifies findings
→ Replan or dispatch repair Workers
→ Wait for Sub Agent results
→ Revalidate
```

Do not mark a finding resolved without evidence and revalidation.
