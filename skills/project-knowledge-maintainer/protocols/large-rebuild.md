# Large / XL Rebuild Protocol

Use for repository-wide refresh, large ingest, knowledge-base repair, or high ambiguity.

Flow:

```text
Route
→ Scope Scan / Noise Filter
→ Domain Planner fan-out
→ Global Plan A merge
→ Plan A validation
→ Task Plan B
→ Worker Sub Agents
→ Output validation
→ Repair loop if needed
→ Final report
```

No Worker execution begins until Plan A validation returns `PASS`, `BLOCKED`, or an explicit accepted terminal state.
