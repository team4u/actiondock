# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-173%20passed-brightgreen.svg)](https://github.com/team4u/actiondock)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

English | [简体中文](README.zh-CN.md)

Build Agent Tools once. Run them anywhere.

A TypeScript toolchain for building, testing, and shipping AI Agent tools as MCP servers, Agent Skills, HTTP services, or standalone binaries.

```text
TypeScript Action
       │
       ├── ad run          # Local CLI execution
       ├── ad test         # In-memory fast testing
       ├── ad mcp          # STDIO / HTTP MCP server
       ├── ad serve        # Remote HTTP service
       ├── ad export skill # Self-contained Agent Skill
       └── ad build        # Zero-dependency standalone binary
              ↓
         executable binary
```

---

## Why ActionDock?

Agent tools are becoming real software.

They require schema contracts, automated testing, version control, reproducible builds, and multiple distribution targets, rather than copy-pasting business logic across different agent runtimes.

ActionDock treats an Agent Tool as a standard software asset:

- **Code as Contract**: TypeScript and JSON Schema define the tool contract and implementation together with automatic runtime validation.
- **Testable by Default**: Test Actions in an in-memory sandbox in milliseconds without launching network services or configuring external databases.
- **Build Once, Run Anywhere**: The exact same Action runs across CLI, MCP, HTTP microservices, and standalone binaries.
- **Portable Distribution**: Compile an Action Package into a single standalone binary with zero external dependencies (target machines require neither Node.js nor Bun).
- **Agent Skills with SOPs**: Combine deterministic Actions with operational Playbooks and export them as self-contained Agent Skills.
- **Git Native**: Actions and Playbooks are plain text files designed for code reviews, branch workflows, and CI/CD automation pipelines.

---

## Runtime and Dependencies

ActionDock 2.0 provides an upgraded runtime architecture:

- **Daily Development and Runtime**: Natively runs on Node.js 22+ and Node.js 24 LTS. Standard authoring, testing, CLI execution, MCP servers, and HTTP services run directly on Node.js, supporting npm, pnpm, and yarn. Daily execution is completely independent of Bun.
- **Standalone Binary Compilation**: When compiling an Action Package into a zero-dependency standalone binary using `ad build`, the system schedules the external Bun compiler to generate the standalone executable.

---

## Declarative Metadata Manifest Specification

ActionDock 2.0 establishes `actiondock.manifest.json` as the declarative single source of truth for tool metadata:

```json
{
  "schemaVersion": 1,
  "actions": {
    "sample.greet": {
      "entry": "actions/greet.ts",
      "description": "Greeting action demonstrating input, config, and state",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Name of the person to greet" }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" },
          "count": { "type": "number" }
        },
        "required": ["message", "count"]
      },
      "uses": [],
      "tags": ["sample"]
    }
  },
  "assets": []
}
```

- **Zero Side-Effect Discovery**: Tool discovery and metadata parsing require no execution of user TypeScript code, preventing initialization side effects.
- **Static Dependency Closure**: The build planner statically computes dependency closures across Actions and Playbooks, enabling tree-shaking and minimal bundle packaging.
- **Consistent Contracts**: CLI commands, MCP tool endpoints, and documentation generators consume the exact same manifest schema.

---

## Quick Start

### For AI Agents

AI agents can install and discover ActionDock skills using standard skill package managers:

```bash
# Install ActionDock skill globally
npx skills add team4u/actiondock -g -y

# Or install any skill repository globally from GitHub
npx skills add <owner/repo> -g -y
```

Once installed, your agent automatically reads the SOP playbooks and invokes the deterministic actions.

### Standard Developer Workflow

Use standard Node.js and npm workflows:

- Install the CLI globally:
```bash
npm install -g @actiondock/cli
```

- Initialize a project scaffold:
```bash
ad init hello-tools
cd hello-tools
npm install
```

- Run unit tests:
```bash
npm test
```

- Execute an Action locally:
```bash
ad run sample.greet --input '{"name":"ActionDock"}'
```

- Start as an MCP server:
```bash
ad mcp
```

- Export as an Agent Skill:
```bash
ad export skill
```

- Compile into a standalone binary (requires external Bun compiler):
```bash
ad build
```

---

## Action and Playbook

ActionDock separates capability from procedure:

```text
Action   = What an agent can do (deterministic capability)
Playbook = How an agent should do it (operational procedure)

             ↓ combined into

         Agent Skill
```

### Define an Action

In `actions/greet.ts`:

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.greet",
  description: "Greet a user and track greeting count in persistent state",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the person" },
    },
    required: ["name"],
  },

  async run(input, ctx) {
    const prefix = ctx.config.get("GREETING_PREFIX", "Hello");
    const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
    await ctx.state.set(`greet:${input.name}`, count);
    ctx.log.info(`User ${input.name} greeted ${count} time(s)`);

    return {
      message: `${prefix}, ${input.name}!`,
      count,
    };
  },
});
```

### Write a Playbook

In `playbooks/greet-user.md`:

```markdown
---
id: greet-user
description: Standard operating procedure for greeting users
actions:
  - sample.greet
---

# User Greeting Procedure

When greeting a new user in the conversation:

- Verify the user's name; never assume unverified nicknames.
- Execute `sample.greet` to perform the greeting and read the count.
- If the count exceeds 1, acknowledge the returning user.
```

---

## Feature Comparison

| Capability / Dimension | ActionDock | mcp-use | FastMCP | Arcade MCP |
| :--- | :---: | :---: | :---: | :---: |
| MCP Server (STDIO & HTTP) | Supported | Supported | Supported | Supported |
| TypeScript Native | Supported | Supported | Supported | Supported / Python |
| Pure In-Memory Test Harness | Supported | Supported | Supported | Supported |
| Zero-Dependency Standalone Binary | Supported | — | — | — |
| Agent Skill Export with SOPs | Supported | — | — | — |
| Playbook Procedure Orchestration | Supported | — | — | — |
| Remote HTTP Service Dispatch | Supported | Supported | Supported | Supported |
| Git-Native Text Asset Model | Supported | Supported | Supported | Supported |
| Declarative Manifest Source | Supported | — | — | — |

---

## Architecture and Layering

ActionDock 2.0 adopts a 9-package modular architecture:

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│                 Node.js 24 LTS Facade CLI                   │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────┐┌──────────────────────────────┐
│  @actiondock/runtime-cli    ││    @actiondock/builder       │
│ Shared Runtime & Envelopes  ││ Dependency Closure & Build   │
└──────────────┬──────────────┘└──────────────┬───────────────┘
               │                              │
               ▼                              │
┌─────────────────────────────┐               │
│     @actiondock/mcp         │               │
│  MCP Protocol & Async Tasks │               │
└──────────────┬──────────────┘               │
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/core                       │
│    Domain Model, ActionRunner, Manifest & Driver Contracts  │
└───────┬──────────────┬──────────────┬───────────────┬───────┘
        │              │              │               │
        ▼              ▼              ▼               ▼
┌──────────────┐┌──────────────┐┌─────────────┐┌──────────────┐
│ runtime-node ││ runtime-bun  ││   testing   ││     sdk      │
│Node.js Driver││Bun Assembly  ││Deterministic││Zero-Dep Dev  │
│& tsx Loader  ││for Binaries  ││Test Harness ││Contract      │
└──────────────┘└──────────────┘└─────────────┘└──────────────┘
```

- `@actiondock/cli`: The command line facade running on Node.js 24 LTS, coordinating project initialization, testing, building, and exporting.
- `@actiondock/builder`: Build planning and compiler scheduling package, including `BuildPlanner` dependency closure calculation, `BunCompiler` external compiler driver, and `SkillExporter`.
- `@actiondock/runtime-cli`: Shared runtime commands and envelope formatters, implementing `info`, `action`, `playbook`, `config`, `state`, `runs`, `serve`, and `mcp`.
- `@actiondock/mcp`: MCP adapter providing STDIO and HTTP protocol transports, fully supporting the Tasks asynchronous task extension.
- `@actiondock/core`: Core domain kernel providing project configuration loading, `actiondock.manifest.json` parsing, `SqliteDriver` interface, `ProcessExecutor` interface, `DefaultExecutionService`, and `ActionRunner` state machine.
- `@actiondock/runtime-node`: Node.js runtime adapter providing `node:sqlite` database driver, `execa` process executor, `tsx` module loader, and `node:http` streaming server.
- `@actiondock/runtime-bun`: Bun runtime adapter providing `bun:sqlite` driver, `Bun.spawn` executor, and `Bun.serve` server, designed specifically for standalone binary assembly.
- `@actiondock/testing`: Standalone deterministic test framework offering `FakeClock`, `MockProcessExecutor`, `MemoryStorage`, and the `createTestRuntime` harness.
- `@actiondock/sdk`: Minimal zero-dependency developer contract exporting `defineAction`, `ActionContext`, `execCli`, `spawnDetached`, and core types.

---

## Verification and Testing

```bash
# Run all unit and integration tests (173 tests passing)
bun test

# Run full TypeScript type checks
bun run typecheck
```

---

## License

Apache-2.0 License.
