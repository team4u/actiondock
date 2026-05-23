# All-Stage Delegate Gates

A delegate gate applies whenever any stage is assigned to a team agent, native subagent, or equivalent execution delegate.

## Stages covered

- Router
- Workspace Scanner
- Noise Filter
- Planner
- Document Set Planner
- Task Planner
- Worker
- Validator
- Repair
- Cleanup
- Reporter

## Gate rule

Once a stage is delegated, the leader must wait for an explicit delegate result before advancing past that stage.

Valid delegate result statuses:

- `COMPLETED`
- `FAILED`
- `BLOCKED`
- `NEEDS_REPLAN`
- `UNAVAILABLE`
- `TIMEOUT_REPORTED`

`WAITING` may be used in interim reports, but it is not a completion status.

## Prohibited behavior

The leader must not:

- complete a delegated stage itself while the delegate is slow or pending;
- mark a delegated stage complete without a result;
- mark a target path complete without the assigned Worker delegate result;
- report validation pass without a Validator result;
- mark repairs resolved without Repair delegate evidence;
- perform Cleanup before Cleanup delegate returns;
- produce final completed report before Reporter delegate returns, when Reporter was delegated.

## Phase gate

For phased work, phase N+1 cannot start until phase N delegate results are returned and integrated, except for independent phase branches explicitly marked as parallel-safe.

## Missing result handling

If a delegate has not returned, record the stage as `WAITING`, `BLOCKED`, or `TIMEOUT_REPORTED`. Do not self-complete the work.

## Validation failures

The following are hard failures:

- `delegate_result_missing`
- `delegate_wait_bypassed`
- `stage_delegate_not_dispatched`
- `worker_delegate_not_dispatched`
