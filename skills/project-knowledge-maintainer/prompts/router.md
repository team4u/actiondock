# Router Prompt

## Target outcome

Classify task scale and choose the lightest safe protocol.

## Success criteria

- Scope is classified as XS, S, M, L, or XL.
- Escalation triggers from `references/playbook.md` are considered.
- Execution mode is `subagent` unless valid serial fallback applies.
- Stage-specific references are identified.

## Return format

Return a route result matching `schemas/route.schema.json`.
