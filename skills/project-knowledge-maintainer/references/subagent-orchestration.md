# Subagent Orchestration

Use native subagents whenever the runtime supports them. Serial execution is only a fallback for unavailable subagents, host policy blocks, or explicit user prohibition.

## Leader Duties

The current main agent is the Leader.

- Determine operation mode and gather path-level context.
- Spawn Chief, Planner, Worker, and Validator subagents as required by the operation.
- Validate role outputs against JSON contracts.
- Merge tasks by `target_path`.
- Enforce path safety before any Worker runs.
- Enforce phase barriers.
- Summarize status, update navigation, and write operation reports.
- Do not write substantive domain body docs under `docs/`; assign those to Workers.

## Spawn Granularity

- Chief: spawn at most 1 Chief subagent per run when operation routing requires Chief judgment.
- Planner: spawn 1 Planner subagent per active domain per phase.
- Worker: spawn 1 Worker subagent per unique `target_path`.
- Validator: spawn read-only Validator subagents for large validation runs when useful.

## Parallelism

- Planner subagents in the same phase may run in parallel.
- Worker subagents in the same phase may run in parallel only when their `target_path` values differ.
- Do not start phase N+1 until all phase N Workers have completed or failed.
- Pass failed lower-level context to later phases as missing evidence.

## Task Merging

When multiple Planner tasks share the same `target_path`, merge their task IDs, clues, evidence paths, domain context, dependencies, and confidence into one Worker task instead of dropping duplicates. Keep the lowest confidence if the tasks disagree.

## Worker Ownership

Each Worker owns one target file.

- A Worker may write or prune only its assigned `target_path`.
- No other Worker or Planner may write that path.
- The Leader may reject, merge, or reroute tasks before Workers start, but must not edit the target body content directly.

## Fallback Reporting

When subagents cannot be used, serial fallback is allowed only if the run can still maintain role boundaries. Record the fallback mode, fallback reason, and the required agent/report fields from `ockb-contract.json`.

When subagents are used, record the native-subagent mode and the same required report fields from `ockb-contract.json`.
