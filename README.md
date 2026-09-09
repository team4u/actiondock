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

In an era where AI writes most of the code, the bottleneck of tool development is no longer typing boilerplate glue code—it is deterministic execution, self-healing quality, and zero-maintenance delivery.

Ad-hoc scripts easily break due to missing dependencies, unpinned runtimes, or out-of-order execution. Generic wrapper libraries simply expose APIs to models without guardrails, leading to hallucinations and unexpected destructive actions.

ActionDock establishes Agent Tools as industrial-grade software assets:

- **Humans Define SOPs, Agents Write Implementation**: Humans establish operational boundaries, sequence constraints, and safety guardrails in Playbooks; AI agents write the deterministic Action implementations against contracts.
- **In-Memory Sandbox and Self-Healing Loop**: Test Actions in an in-memory sandbox with deterministic clocks in milliseconds. When AI generates code, it can run automated tests and self-heal autonomously based on structured errors.
- **Zero-Dependency Standalone Distribution**: Compile an Action Package into a single standalone binary. Target machines need neither Node.js nor Bun—just copy and run.
- **Build Once, Deliver Everywhere**: The exact same Action runs seamlessly across CLI, MCP servers, HTTP microservices, and Agent Skills.
- **Code and Contract in Sync**: The declarative manifest acts as the single source of truth for zero-side-effect static analysis, dependency closure computation, and pruning.
- **Git-Native Plain Text Assets**: Actions and Playbooks are plain text files designed for version control, code reviews, and CI/CD pipelines.

---

## Runtime and Dependencies

ActionDock 2.0 provides an upgraded runtime architecture:

- **Daily Development and Runtime**: Natively runs on Node.js 22.13.0 or higher. Standard authoring, testing, CLI execution, MCP servers, and HTTP services run directly on Node.js, supporting npm, pnpm, and yarn. Daily execution is completely independent of Bun.
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

## Authoring Actions and Playbooks

Under the AI-driven development paradigm, humans and agents establish a clear division of responsibility:

- Humans write operational Playbooks to define expert workflows, decision branches, and strict safety guardrails.
- Agents write deterministic Actions against typed contracts and complete self-healing loops via automated unit tests.

```text
Playbook = Human-defined SOPs (workflow sequences, branches, guardrails)
Action   = Agent-implemented code (strongly typed, deterministic capabilities)

             ↓ Combined Export

         Agent Skill Package
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
| Zero-Dependency Standalone Binary | Supported | — | — | — |
| In-Memory Sandbox & Self-Healing Testing | Supported | Supported | Supported | Supported |
| Procedure & Guardrail Decoupling (Playbook) | Supported | — | — | — |
| Self-Contained Agent Skill Export | Supported | — | — | — |
| Declarative Manifest & Dependency Pruning | Supported | — | — | — |
| Multimodal Delivery (CLI, MCP, HTTP, Skill) | Supported | Partial | Partial | Partial |
| MCP Protocol Native (STDIO & HTTP) | Supported | Supported | Supported | Supported |
| Remote HTTP Service Dispatch | Supported | Supported | Supported | Supported |
| Git-Native Plain Text Asset Model | Supported | Supported | Supported | Supported |

---

## Architecture and Layering

ActionDock 2.0 adopts an 8-package modular architecture:

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│   Node.js Facade CLI, Standalone Dispatcher & Envelopes     │
└──────────────┬──────────────┬───────────────┬───────────────┘
               │              │               │
               ▼              ▼               ▼
┌─────────────────────────────┐┌──────────────────────────────┐
│     @actiondock/mcp         ││    @actiondock/builder       │
│  MCP Protocol & Async Tasks ││ Dependency Closure & Build   │
└──────────────┬──────────────┘└──────────────┬───────────────┘
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

- `@actiondock/cli`: The command line toolchain and standalone dispatcher running on Node.js 22.13.0 or higher, coordinating project initialization, execution, testing, building, and exporting with structured envelope rendering.
- `@actiondock/builder`: Build planning and compiler scheduling package, including `BuildPlanner` dependency closure calculation, `BunCompiler` external compiler driver, and `SkillExporter`.
- `@actiondock/mcp`: MCP adapter providing STDIO and HTTP protocol transports, fully supporting the Tasks asynchronous task extension.
- `@actiondock/core`: Core domain kernel providing project configuration loading, `actiondock.manifest.json` parsing, `SqliteDriver` interface, `ProcessExecutor` interface, `DefaultExecutionService`, and `ActionRunner` state machine.
- `@actiondock/runtime-node`: Node.js runtime adapter providing `node:sqlite` database driver, `execa` process executor, `tsx` module loader, and `node:http` streaming server.
- `@actiondock/runtime-bun`: Bun runtime adapter providing `bun:sqlite` driver, `Bun.spawn` executor, and `Bun.serve` server, designed specifically for standalone binary assembly.
- `@actiondock/testing`: Standalone deterministic test framework offering `FakeClock`, `MockProcessExecutor`, `MemoryStorage`, and the `createTestRuntime` harness.
- `@actiondock/sdk`: Minimal zero-dependency developer contract exporting `defineAction`, `ActionContext`, and core types.

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
