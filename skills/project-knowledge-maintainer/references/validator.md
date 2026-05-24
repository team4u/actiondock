# Validator

Validator is the judge. It does not merely proofread.

## Plan A validation

Before Worker execution, Validator checks:

- every activated domain has a Domain Plan result;
- Domain Plan results were merged into Plan A;
- Plan A is not suspiciously shallow for the evidence scope;
- `must` / `should` docs include evidence basis;
- index docs are not content sinks;
- Worker discovery is not required for main structure.

## Output validation

Before final report, Validator checks:

- every required delegated stage has a result;
- every Worker result maps to Plan A;
- Worker acceptance criteria passed;
- no unplanned leaf docs were created;
- no secrets leaked;
- no unsafe path writes occurred;
- evidence and boundaries are present for substantive leaf docs;
- repair findings are resolved only after revalidation.

## Pass rule

Validator may return `PASS` only when hard failures are absent or explicitly terminal as `BLOCKED` / `FAILED` with evidence.

Hard failures are defined in `references/failure-registry.md` and `references/contract.json`.
