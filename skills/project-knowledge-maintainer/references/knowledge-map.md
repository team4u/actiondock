# Knowledge Map

`docs/_meta/knowledge-map.json` is the machine-owned index for formal knowledge coverage.

Use it to reduce duplicate scanning, avoid fragmented docs, and make validation deterministic.

## Purpose

- map evidence paths to canonical docs
- record which formal doc owns a topic
- mark whether a target affects `ACTIONDOCK.md`
- record freshness and confidence for validate runs

## Shape

Each entry should be small and deterministic:

```json
{
  "version": 1,
  "entries": [
    {
      "target_path": "docs/data/schema.md",
      "kind": "data-schema",
      "domain": "Data",
      "owner_key": "schema:core-db",
      "evidence_paths": [
        "db/migrations/V12__add_user_status.sql",
        "src/main/java/com/example/UserEntity.java"
      ],
      "topics": ["user status", "core db schema"],
      "nav_impact": true,
      "last_verified_at": "2026-05-22",
      "confidence": "high"
    }
  ]
}
```

## Rules

- `target_path` must be unique across entries.
- `owner_key` identifies one canonical doc owner for one logical topic cluster.
- Prefer updating an existing owner entry over creating a new one.
- `confidence` is `high`, `medium`, or `low`.
- `nav_impact=true` means the target should be considered when regenerating `ACTIONDOCK.md`.
- Remove entries only when the target is truly pruned; otherwise refresh them in place.

## When to Create a New Entry

- no existing entry covers the evidence or topic
- the current target would become a mixed-topic dump
- the repository already separates this topic into a stable dedicated page

## When Not to Create a New Entry

- the change fits an existing target with the same owner topic
- the change is only a stale subsection inside a composite doc
- the evidence is too weak to justify a formal page
