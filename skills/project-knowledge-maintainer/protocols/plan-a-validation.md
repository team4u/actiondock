# Plan A Validation Protocol

Run before Worker execution whenever Plan A is required.

Validator checks:

1. all activated domains have Domain Plan results;
2. each Domain Plan contains an evidence-based inventory;
3. Global Plan A merged all Domain Plans;
4. Plan A is not a shallow list of only index/overview docs;
5. every `must` / `should` doc has evidence basis and acceptance criteria;
6. Workers are not expected to discover the main document set.

Failure returns `FAIL_NEEDS_REPLAN` and blocks Worker dispatch.
