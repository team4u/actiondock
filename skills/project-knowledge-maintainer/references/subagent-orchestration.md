# Subagent Orchestration

Use native subagents whenever the runtime supports them. Follow `references/ockb-contract.json` for exact role names, report fields, and fallback invariants. Serial execution is only a fallback for unavailable subagents, host policy blocks, or explicit user prohibition.

## Leader Duties

The current main agent is the Leader.

- run deterministic `preflight`
- derive candidate targets from evidence and `knowledge-map`
- classify candidates as `write`, `defer`, or `skip`
- decide the run profile
- spawn `Chief`, `Impact Analyzer`, Planner, and Worker subagents only when the chosen profile needs them
- validate role outputs against the contract JSON
- deduplicate tasks by `target_path`
- enforce path safety before any Worker runs
- enforce phase barriers for `standard` and `deep` runs
- update `docs/_meta/knowledge-map.json`
- update `ACTIONDOCK.md` only when navigation changed
- summarize status and write operation reports
- do not write substantive domain body docs under `docs/`; assign those to Workers

## Spawn Granularity

- `Chief`: 0 or 1 per run; required for `standard` and `deep`, usually skipped for `thin`
- `Impact Analyzer`: at most 1 per run, only for ownership or scope ambiguity
- Planner: 1 per active domain per phase for `standard` and `deep`; 1 per narrow target bundle only when a `thin` run still needs planning
- Worker: 1 per unique `target_path`

## Right-size Subagents

Subagents are for single responsibility and context control, not maximum parallelism.

- Do not spawn planners for targets that deterministic preflight already resolved.
- `thin` runs should often skip `Chief`, `Impact Analyzer`, and Planner subagents entirely.
- Do not spawn planners or Workers for deferred or skipped candidates.
- Use `maxFanout` from the contract input to cap concurrent Worker tasks.
- When a target is uncertain, record an evidence gap or review note before widening the run.
- Keep each subagent prompt narrow: pass the operation, assigned target, relevant paths, and only the evidence context it needs.

## Parallelism

- Planner subagents in the same phase may run in parallel when their target sets do not overlap.
- Worker subagents in the same phase may run in parallel only when their `target_path` values differ.
- Do not start the next phase in a `standard` or `deep` run until the current phase's Workers have completed or failed.
- A failed target does not block unrelated targets.
- When one target fails and later targets depend on it, pass the missing context forward as an evidence gap.

## Worker Ownership

Each Worker owns one target file.

- A Worker may write or prune only its assigned `target_path`.
- No other Worker or Planner may write that path.
- The Leader may reject, merge, or reroute tasks before Workers start, but must not edit the target body content directly.
- By default a Worker may read only:
  - its current target
  - its assigned `evidence_paths`
  - `existing_doc_paths`
  - any explicitly assigned supporting docs

## Fallback Reporting

When subagents cannot be used, serial fallback is allowed only if the run can still maintain role boundaries. Record these report fields:

```json
{
  "subagent_mode": "serial_fallback",
  "subagent_unavailable_fallback": true,
  "fallback_reason": "runtime_unavailable|host_policy_blocked|user_forbidden",
  "chief_agent": "serial",
  "impact_analyzer": "serial",
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
  "impact_analyzer": "not_needed",
  "planner_agents": ["Data@phase0"],
  "worker_agents": ["docs/data/schema.md"]
}
```
