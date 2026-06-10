# Delegate Gates

Any delegated stage is gated. The leader must wait for the Sub Agent result before advancing past that stage.

Covered stages:

- Router
- Scope Scanner
- Domain Planner
- Global Planner
- Task Planner
- Worker
- Validator
- Repair Planner
- Reporter

## Required result

A delegated stage must return a structured result with a status:

- `PASS`
- `FAIL_REPAIRABLE`
- `FAIL_NEEDS_REPLAN`
- `BLOCKED`
- `INSUFFICIENT_EVIDENCE`
- `UNAVAILABLE`

`WAITING` is an interim state, not completion.

## Forbidden bypass

The leader may not self-complete a delegated stage because the delegate is slow, pending, not returned, or inconvenient.

If a delegate result is missing, the dependent stage is blocked until the result arrives or the runtime explicitly reports unavailability.

Hard failures:

- `delegate_result_missing`
- `delegate_wait_bypassed`
- `leader_self_completed_dispatched_stage`
