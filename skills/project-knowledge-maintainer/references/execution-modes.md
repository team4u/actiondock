# Execution Modes

## Priority

```text
team_agent > native_subagent > serial
```

Use the highest available mode unless the user forbids it.

## team_agent

Use when the environment supports team agents, team tasks, agent members, or equivalent distributed roles. This mode is preferred for M/L/XL tasks and for any stage that benefits from separation of concerns.

Eligible delegated roles:

- Router
- Workspace Scanner
- Noise Filter
- Planner
- Document Set Planner
- Task Planner
- Worker
- Validator
- Repair
- Cleanup
- Reporter

## native_subagent

Use when system-native subagents or isolated task agents are available but team agents are not.

## serial

Use only when:

- team agents are unavailable and native subagents are unavailable;
- the user explicitly forbids delegation;
- the environment rejects delegate creation;
- a delegate returns `UNAVAILABLE` and no equivalent delegate lane exists;
- the task is XS/S and the selected protocol permits inline execution.

Invalid fallback reasons:

- delegate is slow
- delegate is pending
- leader is impatient
- saving time
- convenience
- leader thinks it can do better
- avoiding coordination overhead on M/L/XL tasks

A serial fallback must be recorded with `fallback_reason`, `attempted_mode`, and `evidence`.
