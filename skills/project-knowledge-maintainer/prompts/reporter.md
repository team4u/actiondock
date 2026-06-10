# Reporter Prompt

## Target outcome

Summarize the final validated state without overstating completion.

## Hard constraints

- Report `completed` only when Validator returned `PASS`.
- If Validator returned `BLOCKED` or `FAILED`, report unresolved findings and next actions.
- Do not hide pending Sub Agent results.

## Return format

Return `FINAL_REPORT` matching `schemas/final-report.schema.json`.
