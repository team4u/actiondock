# @actiondock/cli

The official Command Line Interface (CLI) toolchain for ActionDock 2.0.

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/cli` provides the `ac` command to develop, test, build, deploy, and export AI Agent Actions and Skills across MCP, HTTP, CLI, and standalone executables.

---

## Installation

```bash
# Global installation via Bun
bun add -g @actiondock/cli

# Or via npm
npm install -g @actiondock/cli
```

---

## Quick Start in 5 Steps

```bash
# 1. Initialize a new Action package scaffold
ac init my-tools
cd my-tools

# 2. Run an Action locally (outputs standard JSON envelope)
ac run sample.greet --input '{"name": "Alice"}'

# 3. Run in-memory unit tests
ac test

# 4. Compile into a single standalone binary
ac build

# 5. Export as a portable Agent Skill (with SOPs)
ac export skill
```

---

## Command Cheat Sheet

| Command | Purpose |
|---|---|
| `ac init [dir]` | Initialize an Action package scaffold |
| `ac info [patterns...]` | Explore capabilities and display project metadata, actions, and playbooks (supports fuzzy matching) |
| `ac action list` / `ac run <id>` | List and execute Actions |
| `ac playbook list` / `show` | Inspect agent task SOP Playbooks |
| `ac config list` / `get` / `set` | Manage runtime configurations |
| `ac state list` / `get` / `set` / `delete` / `clear` | Inspect and manage persistent state (with namespaces, TTL, and clear) |
| `ac runs list` / `show` | Inspect execution history and traces |
| `ac test` | Run fast unit tests |
| `ac build` | Compile into a zero-dependency standalone binary |
| `ac export skill` | Export Skill bundle for AI Agent platforms |
| `ac link` / `unlink` | Register package in global cross-directory router |
| `ac profile` / `ac serve` | Manage remote node profiles and start HTTP Runner |
| `ac mcp` | Start ActionDock as STDIO or HTTP MCP server |

---

## 📖 Complete Documentation

For the full list of flags, options, remote profiles, and advanced usage, refer to the [ActionDock Documentation Center](https://github.com/team4u/actiondock#readme):

- [CLI Reference Manual](https://github.com/team4u/actiondock/blob/main/docs/reference/cli.md)
- [Quick Start Guide](https://github.com/team4u/actiondock/blob/main/docs/getting-started/quick-start.md)
- [MCP Integration Guide](https://github.com/team4u/actiondock/blob/main/docs/guides/mcp.md)
- [Standalone Binary Build Guide](https://github.com/team4u/actiondock/blob/main/docs/guides/standalone-build.md)
- [Skill Export Guide](https://github.com/team4u/actiondock/blob/main/docs/guides/skill-export.md)

---

## License

[Apache-2.0](LICENSE) © team4u
