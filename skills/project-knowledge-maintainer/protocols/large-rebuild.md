# Protocol: Large / XL Rebuild

Use for broad refreshes, monorepos, full knowledge-base reconstruction, large ingest, stale documentation repair, or high ambiguity.

## Flow

```text
Route
→ Workspace Scan
→ Noise Filter
→ Document Set Plan A
→ Task Plan B
→ Delegate Dispatch
→ Delegate Wait Gate
→ Integration
→ Validator
→ Repair Loop if needed
→ Final Report
```

## Mandatory features

- Plan A is required.
- Domain coverage matrix is required.
- Delegate use is required when team agents or subagents are available.
- All delegated stages are gated.
- Validation is full, not lite.

## Domain coverage matrix

Planner must explicitly consider:

- architecture
- api
- data
- business_flow
- agent_tool
- infra_env
- maintenance_ops

Only activated domains need Worker tasks, but skipped domains must be justified for L/XL.

## Noise filter

Separate durable facts from:

- stale docs
- generated output
- deprecated examples
- test fixtures that do not represent runtime behavior
- speculative notes
- old inbox material

## Completion

Do not report completion if Plan A is incomplete, delegated stages are unresolved, validation failed, or repair was claimed without evidence.
