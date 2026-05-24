# Medium Task Protocol

Use for multiple docs or selective multi-domain updates when a full repository rebuild is not required.

Flow:

```text
Route
→ Scope Scan
→ Selective Domain Planner or Mini Plan A
→ Task Plan B
→ Worker execution
→ Validation
→ Report
```

Escalate to Large / XL when any of these appear:

- the update crosses API/data/business-flow/infra boundaries;
- document structure is unclear;
- existing docs are under-split;
- Workers would need to discover missing target docs;
- the user wants higher coverage or more documents.

Default execution still includes `existing + must + should` for the selected scope.
