# Large / XL Rebuild Protocol

Use for repository-wide refresh, large ingest, knowledge-base repair, high ambiguity, or explicit coverage expansion.

Flow:

```text
Route
→ Scope Scan / Noise Filter
→ Domain Planner fan-out
→ Global Plan A preserving merge
→ Plan A validation
→ Task Plan B by execution scope
→ Worker Sub Agents
→ Output validation
→ Repair loop if needed
→ Final report
```

No Worker execution begins until Plan A validation returns `PASS`, `BLOCKED`, or an explicit accepted terminal state.

## Coverage rule

For rebuilds, default Plan B executes `existing + must + should`. If the user asks for broader coverage or the current docs are too sparse, use high-coverage mode and include evidenced `candidate` documents unless doing so would violate safety or explicit scope limits.
