# Playbook

## Runtime loading rule

Choose the lightest safe protocol and load only the references needed for the active stage. Do not load examples during normal runs.

Choose the lightest protocol that can safely reach validated completion.

## Scale routing

| Scale | Use when | Protocol |
|---|---|---|
| XS | typo, link, one-line env note, one local edit | `protocols/xs-lite.md` |
| S | one small doc area, local update, no structure risk | `protocols/small-task.md` |
| M | multiple docs or domains, no full rebuild | `protocols/medium-task.md` |
| L | broad feature, API/data/flow refresh, knowledge-base repair | `protocols/large-rebuild.md` |
| XL | monorepo, large ingest, full reconstruction, high ambiguity | `protocols/large-rebuild.md` |

## Escalation triggers

Escalate from XS/S to M/L/XL when any appear:

- multiple knowledge domains;
- multiple target docs;
- index content sink risk;
- under-split existing docs;
- API/data/business-flow changes together;
- large ingest or repo-wide scan;
- Workers would need to discover missing document structure;
- a single Planner would likely collapse several domains into one or two broad docs;
- the user wants broader documentation coverage or says the current document set is too small.

## Scenario matrix

| Scenario | Minimum scale | Required extras |
|---|---:|---|
| Fix broken doc link | XS | validate link target |
| Update one env var doc | S | secret safety, evidence path |
| Add docs for a feature touching API and DB | M | selective Domain Planner or Plan A if structure risk |
| Rebuild docs from repo evidence | L | Domain Planners, preserving Plan A merge, Plan A validation, Workers, Output Validator |
| Ingest large `.kb_inbox/` archive | XL | noise filter, Domain Planners, phased Plan B, repair loop |
| Increase documentation coverage | L | Domain Planner breadth check, `must + should` default execution, evidenced candidates in high-coverage mode |

## Core flows

```text
XS: Route-lite → Apply → Validate-lite → Report
S:  Route-lite → Mini Plan → Apply → Validate-lite → Report
M:  Route → Task Plan or selective Plan A → Sub Agent execution → Validate → Report
L:  Route → Scope Scan → Domain Planners → Preserving Plan A merge → Plan A Validate → Plan B → Workers → Output Validate → Repair if needed → Report
XL: Route → Scope Partition → Noise Filter → Domain Planners → Preserving Plan A merge → Plan A Validate → Phased Plan B → Workers → Output Validate → Repair if needed → Report
```
