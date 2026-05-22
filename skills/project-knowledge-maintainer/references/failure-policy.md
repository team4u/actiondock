# Failure Policy

## Retry Policy

Classify the failure before retrying.

- Filesystem or command failure:
  - capture command, exit code, stdout summary, and stderr
  - retry with the error text and the same assigned evidence
- Missing or conflicting evidence:
  - do not loop blindly
  - retry once with a narrow evidence rediscovery step limited to likely owner paths
- Validation failure after write:
  - allow one repair pass for the same target

Allow at most 3 attempts total for one target.

## No Dirty Writes

If evidence remains unavailable or the Worker cannot confidently assemble the document after all retries:

- do not overwrite the target with partial content
- preserve the previous version of the target file
- mark the task `FAILED`
- append or create an error entry under `docs/ops/maintenance/errors.md` if the operation is mutating
- include the failure in the operation report

## Parallel Safety

- never run two Workers that write the same `target_path` concurrently
- keep concurrent Workers within `maxFanout`
- a failed task does not block unrelated tasks
- pass failed lower-level context to dependent tasks as missing evidence
- in `standard` or `deep` runs, if a failed target blocks a later phase, return the gap to the Leader instead of guessing through the dependency

## Path Safety

Before a Worker writes or deletes:

- resolve the target relative to `repoPath`
- reject absolute paths
- reject paths containing `..`
- reject wildcards
- reject targets outside `ACTIONDOCK.md`, operation reports, `docs/`, or `docs/_meta/knowledge-map.json`
- reject directory deletion
