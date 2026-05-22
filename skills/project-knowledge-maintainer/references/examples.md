# Examples

## Canonical Outputs

### Chief

```json
{
  "profile": "standard",
  "phases": [
    {
      "phase_num": 0,
      "domains_to_activate": ["Data"],
      "reason": "Migration changes should settle before dependent docs."
    },
    {
      "phase_num": 1,
      "domains_to_activate": ["API"],
      "reason": "The HTTP contract depends on the schema change."
    }
  ]
}
```

### Impact Analyzer

```json
{
  "decisions": [
    {
      "decision": "write",
      "impact": "material",
      "target_path": "docs/data/schema.md",
      "mode": "update",
      "kind": "data-schema",
      "evidence_paths": ["db/migrations/V12__add_user_status.sql"],
      "existing_doc_paths": ["docs/data/schema.md"],
      "confidence": "high",
      "nav_impact": false,
      "reason": "The existing schema doc already owns the core database overview."
    }
  ]
}
```

### Planner

```json
{
  "tasks": [
    {
      "mode": "update",
      "target_path": "docs/data/tables/users.md",
      "kind": "data-table",
      "evidence_paths": ["db/migrations/20260522_add_user_status.sql"],
      "existing_doc_paths": ["docs/data/tables/users.md"],
      "confidence": "high",
      "nav_impact": false,
      "focus_code_entity": "db/migrations/20260522_add_user_status.sql",
      "clue": "User status column changed; update field table and state semantics."
    }
  ],
  "deferred": [],
  "skipped": []
}
```

### Planner Gap

```json
{
  "tasks": [],
  "deferred": [],
  "skipped": [
    {
      "item": "docs/domain/new-topic.md",
      "reason": "allowNewDocs=false; report ownership gap instead of creating a new canonical page."
    }
  ]
}
```

### Planner Deferred

```json
{
  "tasks": [],
  "deferred": [
    {
      "target_path": "docs/data/schema.md",
      "evidence_paths": ["src/main/java/com/example/UserStatusFormatter.java"],
      "impact": "minor",
      "reason": "Minor naming cleanup; no doc behavior changed yet."
    }
  ],
  "skipped": []
}
```

### Planner Skip

```json
{
  "tasks": [],
  "deferred": [],
  "skipped": [
    {
      "item": "src/generated/client.ts",
      "impact": "noise",
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

### Knowledge Map

```json
{
  "version": 1,
  "entries": [
    {
      "target_path": "docs/data/schema.md",
      "kind": "data-schema",
      "domain": "Data",
      "owner_key": "schema:core-db",
      "evidence_paths": ["db/migrations/V12__add_user_status.sql"],
      "topics": ["core db schema", "user status"],
      "nav_impact": true,
      "last_verified_at": "2026-05-22",
      "confidence": "high",
      "pending_evidence": [
        {
          "path": "src/main/java/com/example/UserStatusFormatter.java",
          "reason": "Minor naming cleanup; no doc behavior changed yet.",
          "first_seen_at": "2026-05-22"
        }
      ]
    }
  ]
}
```

## Smoke Scenarios

- `init`: no `ACTIONDOCK.md` or `docs/` exists; create the smallest evidence-backed docs tree, initialize `docs/_meta/knowledge-map.json`, and write the init report.
- `refresh`: migrations plus API controller changed; reuse owner mappings first, then run `Data` before `API`.
- `ingest`: inbox contains ops notes and unrelated material; absorb only evidence-backed notes and leave unrelated files untouched.
- `validate`: read-only check for broken links, missing evidence sections, stale ownership metadata, duplicate topics, or secrets.
- cosmetic refactor: classify as `skip`; report it without changing docs or `knowledge-map`.
- tiny durable change with an existing owner: classify as `defer`; add capped `pending_evidence` to that owner.
- schema, API, or business behavior change: classify as `write`; produce a Worker task.
- SQL formatting-only migration or mapper churn: classify as `skip`; do not force a formal doc update.
- minor SQL helper rename with the same schema meaning: classify as `defer`; attach it to the existing data owner.
- wide repo refactor crossing schema, HTTP, and runbook behavior: choose `deep`; keep phase barriers.

## Failure Case

- If the target path is unsafe or evidence is missing after retries, the Worker must fail without partial content.
