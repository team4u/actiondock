# Self-Audit Checklist

Use this before packaging or releasing the skill. This file is not part of the normal runtime hot path.

## Required package checks

- `SKILL.md` has YAML frontmatter.
- Frontmatter includes `name`, `version`, `summary`, and a scoped `description`.
- `description` clearly says when to use the skill and when not to use it.
- `references/contract.json` exists and parses as JSON.
- `references/formatter.md` exists and defines required block formats.
- All `schemas/*.json` parse as JSON.
- `references/contract.json` version matches `SKILL.md` version.
- Delegation terminology is consistent: `subagent` for machine-readable values and `Sub Agent` in prose.
- Examples are documented as eval fixtures, not runtime instructions.
- The hot path is short enough for normal runs.

## Required behavior checks

- Sub Agent execution remains preferred over serial.
- Serial fallback is not allowed for slow, pending, inconvenient, or preferred-by-leader reasons.
- Any delegated stage must wait for the explicit Sub Agent result.
- Planner owns document discovery.
- Domain Planners produce evidence-sensitive leaf/runbook/reference inventories.
- Global Planner preserves and merges inventories instead of compressing them.
- Default Plan B executes `existing + must + should`.
- Candidate execution requires high-coverage, repair, or explicit user scope.
- Worker tasks derive from Plan A.
- Worker cannot create unplanned leaf docs.
- Validator decides completion.
- Hard failures block Validator `PASS`.

## Required eval fixture coverage

At minimum, fixtures should cover:

- planner underplanning;
- shallow domain inventory;
- Global Planner inventory compression;
- Plan A containing only index docs;
- missing required leaf doc;
- Worker creating an unplanned doc;
- Leader bypassing a pending Sub Agent;
- Validator passing without evidence;
- repair claimed without revalidation;
- index content sink;
- delegate result missing.
