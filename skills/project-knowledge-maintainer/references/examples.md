# Examples

## Canonical Outputs

### Chief

```json
{
  "profile": "standard",
  "phases": [
    {
      "phase_num": 0,
      "domains_to_activate": ["Data_Model_Planner"],
      "reason": "Migration changes should settle before dependent docs."
    },
    {
      "phase_num": 1,
      "domains_to_activate": ["API_Spec_Planner", "Business_Flow_Planner"],
      "reason": "The HTTP contract and business flow depend on the schema change."
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
      "action": "UPSERT",
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
      "action": "UPSERT",
      "target_path": "docs/data/tables/users.md",
      "kind": "data-table",
      "evidence_paths": [
        "db/migrations/20260522_add_user_status.sql",
        "src/main/java/com/example/UserEntity.java",
        "src/test/java/com/example/UserRepositoryTest.java"
      ],
      "existing_doc_paths": ["docs/data/tables/users.md", "docs/data/schema.md"],
      "confidence": "high",
      "nav_impact": false,
      "focus_code_entity": "db/migrations/20260522_add_user_status.sql",
      "clue": "User status column changed; update field semantics, allowed transitions, transaction implications, and downstream API/business docs that depend on it."
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
      "impact": "material",
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
      "reason": "Minor naming cleanup; no schema or runtime behavior changed yet."
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
      "domain": "Data_Model_Planner",
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

## Deep Documentation Smoke Scenarios

- `init`: no `ACTIONDOCK.md` or `docs/` exists; choose `deep`, create the smallest evidence-backed docs tree, initialize `docs/_meta/knowledge-map.json`, and write an init report.
- `refresh`: migrations plus API controller changed; choose `standard` or `deep`, run `Data_Model_Planner` before `API_Spec_Planner`, and assign Workers enough evidence to document schema semantics and HTTP contract effects.
- `ingest`: inbox contains ops notes and unrelated material; absorb only evidence-backed notes, leave unrelated files untouched, and report preserved inbox paths.
- `validate`: read-only check for broken links, missing evidence sections, stale ownership metadata, duplicate topics, secrets, and shallow docs for material topics.
- cosmetic refactor: classify as `skip`; report it without changing docs or `knowledge-map`.
- tiny durable change with an existing owner: classify as `defer`; add capped `pending_evidence` to that owner.
- schema, API, business behavior, deployment, or runbook change: classify as `write`; produce a full-depth Worker task.
- SQL formatting-only migration or mapper churn: classify as `skip`; do not force a formal doc update.
- minor SQL helper rename with the same schema meaning: classify as `defer`; attach it to the existing data owner.
- wide repo refactor crossing schema, HTTP, and runbook behavior: choose `deep`; keep phase barriers and ownership repair.

## Expected Worker Doc Depth

For an `api-http` target, the Worker should cover routes, handlers, DTOs, auth/config constraints, request/response meaning, error behavior, tests, evidence paths, and open questions.

For a `data-schema` or `data-table` target, the Worker should cover tables/fields, constraints, lifecycle semantics, transaction or migration ordering, dependent services/APIs, rollback or backfill notes when evidenced, tests, and evidence boundaries.

For a `business-flow` target, the Worker should cover triggers, actors, state transitions, data reads/writes, side effects, failure paths, integration points, tests, and out-of-scope cases.

For an `ops-runbook` target, the Worker should cover symptoms, diagnosis commands or logs, safe actions, rollback/escalation conditions, config dependencies, known limits, and evidence freshness.

## Failure Case

- If the target path is unsafe or evidence is missing after retries, the Worker must fail without partial content.
