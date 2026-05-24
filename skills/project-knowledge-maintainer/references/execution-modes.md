# Execution Modes

Use this priority:

```text
subagent > serial
```

## Sub Agent mode

Use Sub Agents for non-trivial stages when the runtime supports them. A Sub Agent may be a system-provided isolated execution unit or equivalent delegated execution context.

Use Sub Agents especially for:

- Domain Planner fan-out
- Plan A validation
- Worker execution by `target_path`
- Output validation
- Repair work

## Serial fallback

Serial is allowed only when:

- Sub Agents are unavailable;
- the user explicitly disables Sub Agents;
- the runtime rejects delegation;
- the task is XS/S and the protocol allows inline execution.

Invalid fallback reasons:

- Sub Agent is slow;
- Sub Agent is pending;
- leader is impatient;
- leader wants to save time;
- leader prefers to do it directly.

Record every fallback reason in the final report.
