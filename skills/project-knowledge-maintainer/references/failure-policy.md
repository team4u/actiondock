# Failure Policy

## Stderr Feedback Loop

When a Worker command fails:

1. Capture command, exit code, stdout summary, and stderr.
2. Retry the Worker with the error text and ask it to rediscover evidence using repository search.
3. Allow at most 3 attempts for one task.

## No Dirty Writes

If evidence remains unavailable or the Worker cannot confidently assemble the document after all retries:

- Do not overwrite the target with partial content.
- Preserve the previous version of the target file.
- Mark the task `FAILED`.
- Append or create an error entry under `docs/ops/maintenance/errors.md` if the operation is mutating.
- Include the failure in the operation report.

## Parallel Safety

- Never run two Workers that write the same `target_path` concurrently.
- Do not run later phases until all earlier phase Workers have finished.
- A failed task does not block unrelated tasks in the same phase.
- A failed lower-level task should be reported to later-phase Workers as missing context when it affects them.

## Path Safety

Before a Worker writes or deletes:

- Resolve the target relative to `repoPath`.
- Reject absolute paths.
- Reject paths containing `..`.
- Reject wildcards.
- Reject targets outside `ACTIONDOCK.md`, operation reports, or `docs/`.
- Reject directory deletion.
