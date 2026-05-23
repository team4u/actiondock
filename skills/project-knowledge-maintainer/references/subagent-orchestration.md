# Subagent Orchestration

Use native subagents whenever the runtime supports them. Follow `references/ockb-contract.json` for exact role names, report fields, and fallback invariants. Serial execution is only a fallback for unavailable subagents, host policy blocks, or explicit user prohibition.

## Leader Duties

The current main agent is the Leader.

- run deterministic preflight
- derive candidate targets from evidence, domain defaults, existing docs, and `knowledge-map`
- classify candidates as `write`, `defer`, or `skip`
- decide the run profile, defaulting to `standard`
- spawn Chief, Impact Analyzer, Planner, and Worker subagents when the chosen profile needs them
- validate role outputs against the contract JSON
- deduplicate tasks by `target_path`
- enforce path safety before any Worker runs
- enforce phase barriers for `standard` and `deep` runs
- update `docs/_meta/knowledge-map.json`
- update `ACTIONDOCK.md` only when navigation changed
- summarize status and write operation reports
- do not write substantive domain body docs under `docs/`; assign those to Workers

## Spawn Granularity

- Chief: 1 per `standard` or `deep` run; 0 only for obviously safe `thin` runs
- Impact Analyzer: at most 1 per run, only for ownership or scope ambiguity
- Planner: 1 per active domain per phase for `standard` and `deep`; optional only for obvious `thin` ownership
- Worker: 1 per unique `target_path`

## Profile Discipline

Profiles control orchestration cost, not output quality.

- `thin` may skip Chief and Planner only when the Leader can prove ownership and significance from local evidence.
- `standard` preserves the older Chief-led phase skeleton and is the default.
- `deep` preserves full phase barriers, broad validation, and ownership repair.
- If an `UPSERT` exists in any profile, the Worker must follow the full depth standard from `prompt-worker.md`.

## Parallelism

- Planner subagents in the same phase may run in parallel when their evidence sets do not overlap.
- Worker subagents in the same phase may run in parallel only when their `target_path` values differ.
- Keep concurrent Workers within `maxFanout`.
- Do not start the next phase in a `standard` or `deep` run until the current phase's Workers have completed or failed.
- A failed target does not block unrelated targets.
- When one target fails and later targets depend on it, pass the missing context forward as an evidence gap.

## Worker Ownership

Each Worker owns one target file.

- A Worker may write or prune only its assigned `target_path`.
- No other Worker or Planner may write that path.
- The Leader may reject, merge, or reroute tasks before Workers start, but must not edit the target body content directly.
- By default a Worker may read:
  - its current target
  - its assigned `evidence_paths`
  - `existing_doc_paths`
  - prior-phase docs explicitly assigned by the Planner or Leader
  - supporting source files needed to resolve imports, table references, routes, or call paths from assigned evidence
- If the Worker needs broader exploration, use the retry and widening rules in `failure-policy.md`.

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
  "fallback_reason": null,
  "chief_agent": "spawned",
  "impact_analyzer": "not_needed",
  "planner_agents": ["Data_Model_Planner@phase0"],
  "worker_agents": ["docs/data/schema.md"]
}
```
