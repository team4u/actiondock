# Evidence Priority

Use evidence in this order:

1. Current repository source code, configuration, migrations, schemas, tests, and build scripts.
2. Runtime contracts: OpenAPI, GraphQL schema, protobufs, database DDL, IaC, CI configs.
3. Existing documentation that matches current code.
4. Recent changelogs, migration notes, runbooks, PR summaries, design notes.
5. User-provided inbox material.
6. Old docs, generated docs, stale notes, comments, speculative descriptions.

If sources conflict, prefer current executable or declarative artifacts over prose. Report the conflict instead of silently choosing stale prose.

Do not invent endpoints, tables, environment variables, commands, workflows, or business rules that are not supported by evidence.

Every substantive document update should be traceable to at least one evidence source path or user-provided source.
