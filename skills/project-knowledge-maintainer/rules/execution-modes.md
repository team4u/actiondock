# Execution Modes

## Priority

```text
subagent > serial
```

Use `subagent` whenever the environment provides subagents or equivalent isolated task agents, unless the user explicitly forbids delegation or the selected XS/S protocol permits inline execution.

## subagent

Use when the environment supports system-provided subagents, isolated task agents, or equivalent delegate lanes. This mode is preferred for M/L/XL tasks and for any stage that benefits from separation of concerns.

Eligible delegated roles:

- Router
- Workspace Scanner
- Noise Filter
- Planner
- Domain Planner
- Document Set Planner
- Task Planner
- Worker
- Validator
- Repair
- Cleanup
- Reporter

A delegated stage is not complete until its subagent result is received and recorded.

## serial

Use only when:

- subagents are unavailable;
- the user explicitly forbids delegation;
- the environment rejects delegate creation;
- a delegate returns `UNAVAILABLE` and no equivalent isolated delegate lane exists;
- the task is XS/S and the selected protocol permits inline execution.

Invalid fallback reasons:

- delegate is slow
- delegate is pending
- leader is impatient
- saving time
- convenience
- leader thinks it can do better
- avoiding coordination overhead on M/L/XL tasks

A serial fallback must be recorded with `fallback_reason`, `attempted_mode`, and evidence.
