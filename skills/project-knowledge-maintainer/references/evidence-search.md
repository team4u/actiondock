# Evidence Search

Use current repository evidence before prose.

## Search order

1. Source code and package/workspace structure.
2. Configuration, environment examples, build scripts, CI, IaC.
3. API contracts: routes, controllers, OpenAPI, GraphQL, protobuf, event schemas.
4. Database evidence: migrations, DDL, ORM models, seed data, queries.
5. Tests that describe runtime behavior.
6. Existing docs and ACTIONDOCK links.
7. Inbox materials and user-provided notes.

## Noise filters

Treat these as low signal unless the repo explicitly uses them as source:

- `node_modules/`, `vendor/`, `.git/`, `.cache/`
- `dist/`, `build/`, `target/`, `coverage/`
- generated clients or generated docs
- formatter-only diffs
- lockfile-only auxiliary changes
- stale examples and fixtures that do not represent runtime behavior

## Evidence boundaries

Every substantive doc should state what evidence was used and what was not verified.

Do not invent endpoints, tables, variables, workflows, or commands. If evidence is missing or conflicting, report the gap.
