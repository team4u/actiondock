# Subagent Orchestration

Use native subagents whenever the runtime supports them. Follow `references/ockb-contract.json` for exact domain names, report fields, and fallback invariants. Serial execution is only a fallback for unavailable subagents, host policy blocks, or explicit user prohibition.

## Leader Duties

The current main agent is the Leader.

- Determine operation mode and gather path-level context.
- Spawn Chief, Planner, and Worker subagents.
- Validate role outputs against JSON contracts.
- Deduplicate tasks by `target_path`.
- Enforce path safety before any Worker runs.
- Enforce phase barriers.
- Summarize status, update navigation, and write operation reports.
- Do not write substantive domain body docs under `docs/`; assign those to Workers.

## Spawn Granularity

- Chief: spawn exactly 1 Chief subagent per run.
- Planner: spawn 1 Planner subagent per active domain per phase.
- Worker: spawn 1 Worker subagent per unique `target_path`.

## Right-size Subagents

Subagents are for single responsibility and context control, not maximum parallelism.

- Treat spawn granularity as ownership guidance, not a reason to launch every possible agent at once.
- Use the selected run profile to decide how far to expand: thin runs stay at the smallest useful group, standard runs follow the normal phase flow, and deep runs may widen coverage when evidence justifies it.
- Activate only domains with direct evidence. `phaseDefaults` define ordering; they are not a checklist of domains to always spawn.
- Start with the smallest useful group of Planner or Worker subagents, then continue after reviewing results.
- When a domain is uncertain, record an evidence gap or review note before spawning exploratory agents.
- Keep each subagent prompt narrow: pass the operation, assigned domain or target, relevant paths, and only the evidence context it needs.

## Parallelism

- Planner subagents in the same phase may run in parallel.
- Worker subagents in the same phase may run in parallel only when their `target_path` values differ.
- Do not start phase N+1 until all phase N Workers have completed or failed.
- Pass failed lower-level context to later phases as missing evidence.

## Worker Ownership

Each Worker owns one target file.

- A Worker may write or prune only its assigned `target_path`.
- No other Worker or Planner may write that path.
- The Leader may reject, merge, or reroute tasks before Workers start, but must not edit the target body content directly.

## Fallback Reporting

When subagents cannot be used, serial fallback is allowed only if the run can still maintain role boundaries. Record these report fields:

```json
{
  "subagent_mode": "serial_fallback",
  "subagent_unavailable_fallback": true,
  "fallback_reason": "runtime_unavailable|host_policy_blocked|user_forbidden",
  "chief_agent": "serial",
  "planner_agents": [],
  "worker_agents": []
}
```

When subagents are used, record:

```json
{
  "subagent_mode": "native_subagents",
  "subagent_unavailable_fallback": false,
  "chief_agent": "spawned",
  "planner_agents": ["Data_Model_Planner"],
  "worker_agents": ["docs/data/tables/users.md"]
}
```
