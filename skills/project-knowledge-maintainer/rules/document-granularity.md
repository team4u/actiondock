# Document Granularity

The knowledge base should be navigable, not monolithic.

## Index rule

Index files are navigation and summary surfaces. They must not become content sinks.

Allowed in index files:

- purpose of the section
- links to leaf docs
- short summaries
- ownership or maintenance notes

Not allowed in index files when substantial:

- complete endpoint references
- full database table catalogs
- long business-process descriptions
- complete environment variable catalogs
- operational runbooks
- large architecture narratives

## Leaf docs

Substantive facts belong in leaf docs organized by domain.

Common domains:

- `architecture`
- `api`
- `data`
- `business_flow`
- `agent_tool`
- `infra_env`
- `maintenance_ops`

## Split triggers

Split documents when content covers:

- multiple resources or bounded contexts
- more than one API group
- multiple database tables with distinct ownership
- multiple workflows
- setup plus operations plus troubleshooting
- concepts plus procedures plus reference material

## Under-split examples

Bad:

```text
docs/index.md
docs/api/index.md
docs/database.md
docs/architecture.md
```

Better:

```text
docs/index.md
docs/api/index.md
docs/api/http/orders.md
docs/api/http/payments.md
docs/api/auth.md
docs/data/index.md
docs/data/tables/orders.md
docs/data/tables/payments.md
docs/flows/checkout.md
docs/infra/env.md
```
