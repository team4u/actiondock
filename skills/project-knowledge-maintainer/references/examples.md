# Examples

## Canonical Outputs

### Chief

```json
{
  "phases": [
    {
      "phase_num": 0,
      "domains_to_activate": ["Data_Model_Planner", "Infra_Env_Planner"],
      "reason": "Migrations and environment changes should settle before dependent docs."
    }
  ]
}
```

### Planner

```json
{
  "tasks": [
    {
      "action": "UPSERT",
      "target_path": "docs/data/tables/users.md",
      "focus_code_entity": "db/migrations/20260522_add_user_status.sql",
      "clue": "User status column changed; update field table and state semantics."
    }
  ],
  "skipped": [
    {
      "item": "src/generated/client.ts",
      "reason": "Generated source; no formal docs update planned."
    }
  ]
}
```

### Worker

```json
{
  "status": "COMPLETED",
  "target_path": "docs/domain/flows/user-registration.md",
  "warnings": []
}
```

## Smoke Scenarios

- `init`: no `ACTIONDOCK.md` or `docs/` exists; create the smallest evidence-backed docs tree and write the init report.
- `refresh`: migrations plus API controller changed; route data and infra first, then dependent API and business docs.
- `ingest`: inbox contains ops notes and unrelated material; archive only the ops evidence and leave unrelated files untouched.
- `validate`: existing docs are read-only checked; report broken links, missing evidence sections, or secrets without rewriting docs.

## Failure Case

- If the target path is unsafe or evidence is missing after retries, the Worker must fail without partial content.
