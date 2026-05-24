# Formatter

This file defines required formatting rules for generated or updated project knowledge artifacts.

## General Markdown rules

- Use stable Markdown headings with one `#` title per file.
- Prefer concise sections and tables over long unstructured prose.
- Preserve code identifiers, paths, API names, table names, JSON fields, commands, and environment variable names exactly.
- Use relative links within the repository.
- Do not include real secrets. Use placeholders such as `<API_KEY>`, `<DB_PASSWORD>`, or `<REDACTED>`.
- Do not paste raw internal prompts, chain-of-thought, delegate logs, or full validation traces into user-facing docs.

## ACTIONDOCK.md format

`ACTIONDOCK.md` is the top-level navigation and maintenance entrypoint. It should contain:

1. Project knowledge index
2. Established documents
3. Pending / no evidence yet
4. Explicitly not applicable
5. Recent maintenance metadata
6. Scenario flags
7. Known evidence gaps
8. Maintenance notes

Rules:

- Link only to documents that exist or are created in the same run.
- Do not use broken placeholder links.
- Do not store full API, data, business-flow, runbook, or troubleshooting content in `ACTIONDOCK.md`.

## Index document format

Index files such as `docs/index.md`, `docs/api/index.md`, or `docs/data/index.md` are navigation surfaces.

Allowed:

- short purpose statement
- links to leaf docs
- one-line summaries
- owner or maintenance notes
- status notes

Not allowed when substantial:

- full endpoint catalogs
- full database table catalogs
- complete runbooks
- full business flows
- long architecture narratives
- complete environment variable catalogs

If content becomes substantive, create or update a leaf doc.

## Leaf substantive document format

Substantive leaf docs should use this shape unless the project already has a stronger house style:

```md
# <Document Title>

## Purpose

What this document covers.

## Current behavior / contract

Facts grounded in repository evidence.

## Important paths

- `path/to/source`: why it matters

## Operational notes

Commands, runbook notes, migration notes, or caveats when supported by evidence.

## Evidence and boundaries

- Evidence: `path/a`, `path/b`
- Boundaries: what was not verified, what is out of scope, stale or conflicting sources
```

The `Evidence and boundaries` section is required for substantive leaf docs.

## Required machine-readable blocks

For required stage outputs, use exactly one fenced JSON block preceded by the block name:

- `ROUTE_RESULT`
- `STAGE_RESULT`
- `DOMAIN_PLAN_RESULT`
- `DOCUMENT_SET_PLAN_A`
- `TASK_PLAN_B`
- `WORKER_RESULT`
- `VALIDATION_REPORT`
- `REPAIR_PLAN`
- `FINAL_REPORT`

Do not mix required machine-readable stage outputs with long freeform prose.

## Final response format

The final response should include:

- operation mode
- execution mode and fallback reason, if any
- flow profile and scale
- delegate result summary
- files created or updated
- validation status
- unresolved blockers or findings

Keep it concise. Do not include raw internal prompts or full tool logs.
