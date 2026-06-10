# Success Loop

Every non-trivial stage operates as a success loop.

A stage is not complete because the assigned action has been attempted. A stage is complete only when its success criteria are satisfied by evidence.

## Required loop

1. Define target outcome.
2. Load hard constraints.
3. Identify acceptance criteria.
4. Execute using required Sub Agents.
5. Self-check against acceptance criteria.
6. Return structured stage result.
7. Validate.
8. If validation fails, repair or replan.

## Stage statuses

- `PASS`
- `FAIL_REPAIRABLE`
- `FAIL_NEEDS_REPLAN`
- `BLOCKED`
- `INSUFFICIENT_EVIDENCE`
- `UNAVAILABLE`

## Forbidden completion claims

Do not mark a stage complete merely because:

- a prompt was sent;
- a file was touched;
- a plan was produced;
- a Worker responded with shallow content;
- the leader believes it is good enough;
- a Sub Agent is slow;
- the remaining work seems obvious.

## Success criteria ownership

- Planner success means the document set is sufficiently discovered and justified.
- Worker success means the target document satisfies its acceptance criteria with evidence.
- Validator success means hard failures are absent or explicitly blocked/failed.
