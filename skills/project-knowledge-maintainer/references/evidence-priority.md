# Evidence Priority

Use evidence in this order:

1. Current repository source code, tests, migrations, schemas, route definitions, configs, package manifests, CI, and deployment files.
2. Existing maintained docs in the repository.
3. `.kb_inbox/` materials and user-provided notes.
4. Generated docs, old exports, or stale snapshots.
5. Assumptions, only when explicitly marked as assumptions.

Prefer current source evidence over stale documentation. When evidence conflicts, report the conflict and do not silently merge unsupported facts.

Every substantive leaf doc should include an `Evidence and boundaries` section listing the main evidence paths and what was not verified.
