# Project Knowledge Maintainer v5.0.0

A repo-aware knowledge-base maintenance protocol for agents that can inspect code, plan documentation structure, delegate work to team agents or subagents, validate outputs, and produce auditable final reports.

This version is a structural rewrite. It replaces a single long playbook with a compact control plane:

- `SKILL.md`: entry protocol.
- `contract.json`: machine-readable policy and hard-error registry.
- `rules/`: non-negotiable constraints.
- `protocols/`: scale-specific execution flows.
- `schemas/`: expected JSON shapes for routing, planning, delegation, validation, and reporting.
- `prompts/`: stage-specific operating prompts.
- `examples/`: failure and success fixtures.

## Design principles

1. Safety is always hard.
2. Planning is complete before delegation.
3. Delegation must be real, waited for, and evidenced.
4. Workers execute planned targets; they do not replace planning.
5. Validation decides completion, not the leader's confidence.

## Execution priority

```text
team_agent > native_subagent > serial
```

When team agents or native subagents are available and the user has not forbidden them, the leader must delegate eligible stages instead of performing them inline. Once delegated, every stage is gated: the leader must wait for an explicit delegate result before advancing.

## Planner rule

For any task requiring a document set plan, Planner must create Plan A: a complete expected document set. Worker tasks are Plan B and must be derived from Plan A. Worker discovery is an overflow signal, not a substitute for planning.
