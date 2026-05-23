# Scenario: Planner under-enumerates a multi-domain repo

User asks for a full project knowledge refresh. Evidence includes routes, migrations, workflows, Docker files, CI deployment, and existing docs. A single Planner returns only `docs/index.md` and `docs/architecture.md`.

Expected behavior: route to L/XL, dispatch Domain Planner passes, reject the shallow global plan, and require Plan A merge before Worker tasks.
