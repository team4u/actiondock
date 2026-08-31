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

## Quick Start

### 1. Initialize a New Action Package

```bash
ac init my-tools
cd my-tools
```

### 2. List & Inspect Actions

```bash
ac action list
ac action show sample.greet
```

### 3. Run Actions Locally

```bash
ac run sample.greet --input '{"name": "Alice"}'
```

### 4. Fast In-Memory Unit Testing

```bash
ac test
```

### 5. Build Standalone Executable Binary

```bash
ac build
# Executable generated in ./dist/my-tools
./dist/my-tools run sample.greet --input '{"name": "Bob"}'
```

### 6. Export as Agent Skill

```bash
# Source Skill
ac export skill

# Standalone Binary Skill
ac export skill --standalone

# Playbook-driven selective export
ac export skill --playbook greet-user
```

---

## Complete CLI Command Reference

### Project & Action Management

| Command | Description |
|---|---|
| `ac init [dir] [--id <id>] [--name <name>]` | Initialize an Action package scaffold |
| `ac info [--json]` | Show current project metadata, actions, and playbooks |
| `ac action list [pattern] [-i, --intent <regex>]` | List actions with intent fuzzy filtering |
| `ac action show <id>` | Show action definition and JSON Schemas |
| `ac action new <id>` | Scaffold a new Action TypeScript file |
| `ac action validate` | Validate action schemas and exports |
| `ac run <id> [--input '<json>'] [--config KEY=val]` | Execute an action and output standard JSON envelope |
| `ac test [pattern]` | Run unit tests with Bun test runner |

### Playbooks (Agent SOPs)

| Command | Description |
|---|---|
| `ac playbook list [pattern] [-i, --intent <regex>]` | List playbooks with intent search |
| `ac playbook show <id>` | View playbook frontmatter and markdown SOP content |
| `ac playbook new <id>` | Scaffold a new playbook markdown file |
| `ac playbook validate` | Validate playbook syntax and action dependencies |

### Configuration & State Management

| Command | Description |
|---|---|
| `ac config list [-i, --intent <regex>]` | List active configuration values and sources |
| `ac config get <key>` | Get specific configuration value |
| `ac config set <key> <val>` | Set local persistent configuration value |
| `ac config delete <key>` | Delete configuration key |
| `ac config schema` | View declared configuration schema and status table |
| `ac state list [-i, --intent <regex>]` | List keys in shared persistent state store |
| `ac state get <key>` | Read state key value |
| `ac state set <key> <val> [--ttl <sec>]` | Set state value with optional TTL (seconds) |
| `ac state delete <key>` | Delete state key |

### Execution History & Runs

| Command | Description |
|---|---|
| `ac runs list [--action <id>] [--limit <n>]` | View execution run history |
| `ac runs show <run-id>` | View complete execution input, output, duration, and errors |
| `ac runs cancel <run-id>` | Cancel an active in-flight remote execution |

### Build & Skill Export

| Command | Description |
|---|---|
| `ac build [-t <target>] [--no-minify] [--no-bytecode]` | Compile actions into a single standalone binary |
| `ac export skill [--standalone] [--playbook <id>]` | Export standard Skill package for AI Agent platforms |

### Global Registry Linking

| Command | Description |
|---|---|
| `ac link [dir]` | Register local package in global routing registry |
| `ac unlink <id>` | Unregister package from global registry |

### Remote Profiles & HTTP Server

| Command | Description |
|---|---|
| `ac profile list` | List configured remote execution profiles |
| `ac profile add <name> --server <url> [--token <token>]` | Configure a remote node profile |
| `ac profile test [name]` | Test latency and connectivity to remote server |
| `ac profile use <name>` | Set active default profile |
| `ac serve [--port 5178] [--token <secret>]` | Start lightweight HTTP Runner server for remote execution |

### Model Context Protocol (MCP)

| Command | Description |
|---|---|
| `ac mcp` | Start ActionDock as STDIO MCP server |
| `ac mcp serve [--port 5178] [--token <secret>]` | Start ActionDock as HTTP MCP server |

---

## License

[Apache-2.0](LICENSE) © team4u
