# Knowledge Map

`docs/_meta/knowledge-map.json` is the machine-owned index for formal knowledge coverage.

Use it to reduce duplicate scanning, avoid fragmented docs, remember deferred evidence, and make validation deterministic. Do not use it to justify shallow Worker output for an approved `UPSERT`.

## Purpose

- map evidence paths to canonical docs
- record which formal doc owns a topic
- mark whether a target affects `ACTIONDOCK.md`
- record freshness and confidence for validate runs
- retain capped pending evidence for minor deferred updates

## Shape

Each entry should be small and deterministic:

```json
{
  "version": 1,
  "entries": [
    {
      "target_path": "docs/data/schema.md",
      "kind": "data-schema",
      "domain": "Data_Model_Planner",
      "owner_key": "schema:core-db",
      "evidence_paths": [
        "db/migrations/V12__add_user_status.sql",
        "src/main/java/com/example/UserEntity.java"
      ],
      "topics": ["user status", "core db schema"],
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

## Rules

- `target_path` must be unique across entries.
- `domain` must use a domain from `ockb-contract.json`.
- `owner_key` identifies one canonical doc owner for one logical topic cluster.
- Prefer updating an existing owner entry over creating a new one.
- Use `knowledge-map` to make ownership deterministic before escalating to Chief, Impact Analyzer, or Planner work.
- `confidence` is `high`, `medium`, or `low`.
- `nav_impact=true` means the target should be considered when regenerating `ACTIONDOCK.md`.
- `pending_evidence` is optional and only for `defer` decisions that already map to this owner.
- Keep `pending_evidence` capped to 5 items per entry; merge or replace older related items instead of growing it unbounded.
- Clear pending evidence when a later `UPSERT` absorbs it into the target doc.
- Remove entries only when the target is truly pruned; otherwise refresh them in place.

## When to Create a New Entry

- no existing entry covers the evidence or topic
- the current target would become a mixed-topic dump
- the repository already separates this topic into a stable dedicated page
- a later phase needs a new canonical owner after Chief routing confirmed the split

## When Not to Create a New Entry

- the change fits an existing target with the same owner topic
- the change is only a stale subsection inside a composite doc
- the evidence is too weak to justify a formal page
- the candidate is a deferred minor update that can attach to an existing owner
