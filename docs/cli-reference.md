# CLI Reference - ActionDock 2.0

Comprehensive reference for the `actiondock` command-line tool.

---

## Global Principles

* `stdout`: Machine-consumable results (Standard JSON Envelope for runs, clean JSON when `--json` flag is provided).
* `stderr`: Diagnostics, warnings, and structured logs.
* Exit Code `0`: Execution succeeded.
* Exit Code non-zero: Execution failed.

---

## Commands

### Project
- `actiondock init [directory]`
  - Options: `-i, --id <id>`, `-n, --name <name>`, `-d, --desc <description>`
  - Scaffolds a new ActionDock project with standard templates.
- `actiondock info [--json]`
  - Displays project metadata, declared actions, and playbooks.

### Actions
- `actiondock action create <id>` (alias: `new`)
  - Options: `-d, --desc <desc>`, `-f, --file <path>`
  - Scaffolds a new Action `.ts` file with standard schema structure.
- `actiondock action list [--json]`
  - Lists all actions discovered in the project.
- `actiondock action show <id>` (alias: `describe`)
  - Displays description, input JSON schema, and output JSON schema.
- `actiondock action validate [id] [--json]`
  - Validates JSON schemas and action definitions.
- `actiondock action run <id>` (or `actiondock run <id>`)
  - Options:
    - `-i, --input '<json>'`
    - `-f, --input-file <path>`
    - `-c, --config <KEY=val>`
  - Runs the action and prints the execution result envelope.

### Playbooks
- `actiondock playbook create <id>` (alias: `new`)
  - Options: `-d, --desc <desc>`, `-a, --actions <actions...>`, `-f, --file <path>`
  - Scaffolds a new Playbook `.md` file.
- `actiondock playbook list [--json]`
  - Lists all playbooks discovered in the project.
- `actiondock playbook show <id> [--json]`
  - Displays playbook frontmatter and SOP markdown content.
- `actiondock playbook validate [id] [--json]`
  - Validates playbook frontmatter and action references.

### Configuration
- `actiondock config list [--json]`
- `actiondock config get <key> [--json]`
- `actiondock config set <key> <value>`
- `actiondock config delete <key>`

### Shared State
- `actiondock state list [prefix] [--json]`
- `actiondock state get <key> [--json]`
- `actiondock state set <key> <json-value>`
- `actiondock state delete <key>`

### Run History
- `actiondock runs list [-a, --action <id>] [-n, --limit <count>] [--json]`
- `actiondock runs show <run-id> [--json]`

### Testing
- `actiondock test [pattern]`
  - Runs tests via the Bun test runner.

### Build & Skill Export
- `actiondock build [-t, --target <target>] [-o, --out <path>] [-m, --minify]`
  - Compiles project into a standalone executable.
- `actiondock export skill [-t, --target <target>] [-o, --out <path>] [-z, --archive]`
  - Exports a complete standalone Skill bundle with `SKILL.md` and binary.
