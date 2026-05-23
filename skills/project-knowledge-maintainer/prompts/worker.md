# Worker Prompt

Execute exactly one planned target path unless assigned a scan-only, validation-only, or approved integration task.

Read broadly. Write narrowly.

Return JSON matching `schemas/delegate-result.schema.json`.

If you discover a missing document, do not create it. Return `NEEDS_REPLAN` and include `proposed_extra_tasks`.
