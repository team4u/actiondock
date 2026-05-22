# Examples

## Canonical Outputs

### Impact Analyzer

```json
{
  "decisions": [
    {
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
  "task": {
    "mode": "update",
    "target_path": "docs/data/tables/users.md",
    "kind": "data-table",
    "evidence_paths": ["db/migrations/20260522_add_user_status.sql"],
    "existing_doc_paths": ["docs/data/tables/users.md"],
    "confidence": "high",
    "nav_impact": false,
    "focus_code_entity": "db/migrations/20260522_add_user_status.sql",
    "clue": "User status column changed; update field table and state semantics."
  },
  "skipped": []
}
```

### Planner Gap

```json
{
  "task": null,
  "skipped": [
    {
      "item": "docs/domain/new-topic.md",
      "reason": "allowNewDocs=false; report ownership gap instead of creating a new canonical page."
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
      "confidence": "high"
    }
  ]
}
```

## Smoke Scenarios

- `init`: no `ACTIONDOCK.md` or `docs/` exists; create the smallest evidence-backed docs tree, initialize `docs/_meta/knowledge-map.json`, and write the init report.
- `refresh`: migrations plus API controller changed; reuse owner mappings first, then update dependent data and API docs.
- `ingest`: inbox contains ops notes and unrelated material; absorb only evidence-backed notes and leave unrelated files untouched.
- `validate`: read-only check for broken links, missing evidence sections, stale ownership metadata, duplicate topics, or secrets.

## Failure Case

- If the target path is unsafe or evidence is missing after retries, the Worker must fail without partial content.
