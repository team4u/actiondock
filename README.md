# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[Documentation](https://team4u.github.io/actiondock/) | English | [简体中文](README.zh-CN.md)

Build Agent Tools once. Run them anywhere.

An industrial-grade toolchain for developing, testing, building, and distributing AI Agent Actions and Skills. Seamlessly deliver atomic capabilities as MCP protocol servers, Agent Skills, HTTP microservices, or self-contained Node.js delivery directories.

```text
TypeScript Action Source
       │
       ├── ad run          # Local CLI execution
       ├── ad test         # Millisecond-level in-memory sandbox tests
       ├── ad mcp          # STDIO & HTTP MCP protocol server
       ├── ad serve        # Production HTTP microservice
       ├── ad export skill # Portable Agent Skill package (source & node modes)
       ├── ad pack         # Standard npm tarball packaging
       └── ad build        # Self-contained Node.js runtime delivery build
              ↓
       runnable package
```

---

## Core Philosophy

In an era where AI writes most of the code, the bottleneck of tool engineering is no longer boilerplate glue code—it is deterministic execution, self-healing quality, and zero-maintenance delivery.

Ad-hoc scripts easily break due to missing dependencies, unpinned runtimes, or environment drift. Generic wrapper libraries simply expose raw functions to models without guardrails, leading to hallucinations or accidental destructive actions.

ActionDock establishes Agent Tools as industrial-grade software assets:

- Humans Define SOPs, Agents Write Implementation: Humans establish operational boundaries, sequence constraints, and safety guardrails in Playbooks; AI agents write the deterministic Action implementations against typed contracts.
- In-Memory Sandbox and Self-Healing Loop: Test Actions in an in-memory sandbox with deterministic clocks in milliseconds. When AI generates code, it can run automated tests and self-heal autonomously based on structured errors.
- Standard Node.js Delivery Format: Build an Action Package into a self-contained, runnable Node.js delivery directory with locked production dependencies or pack into standard npm packages.
- Build Once, Deliver Everywhere: The exact same Action runs seamlessly across CLI, MCP servers, HTTP microservices, and Agent Skills.
- Deterministic Lockfile and Atomic Dependency Management: Project dependencies are locked via actiondock.lock.json with atomic transaction rollbacks for ad add and ad remove.
- Git-Native Plain Text Assets: Actions and Playbooks are plain text files designed for version control, code reviews, and CI/CD pipelines.

---

## Runtime and Dependencies

ActionDock 2.0 natively targets Node.js >=24.12.0:

- Native Runtime Engine: Powered by Node.js native type stripping, built-in SQLite (node:sqlite), and native HTTP. Standard development, testing, CLI execution, MCP servers, and HTTP services run directly on Node.js without external build tools.
- Standard npm Workflow: Fully aligned with standard ecosystem tooling (npm test, npm run typecheck, npm run build, npm run test:pack).

---

## Quick Start

### For AI Agents

AI agents can discover and install ActionDock skills using standard skill package managers:

```bash
# Install ActionDock official skill globally
npx skills add team4u/actiondock -g -y

# Or install any skill repository from GitHub
npx skills add <owner/repo> -g -y
```

Once installed, your agent automatically reads the SOP playbooks and invokes the deterministic actions.

### Standard Developer Workflow

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

- Add a dependency with atomic lockfile management:
```bash
ad add @actiondock/example-tools
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
# Export source-mode skill
ad export skill

# Export self-contained Node.js directory skill
ad export skill --mode node
```

- Build a runnable Node.js delivery directory:
```bash
ad build
```

- Pack into a standard npm tarball:
```bash
ad pack
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

          Agent Skill portable package
```

### Defining an Atomic Action

Define an Action with type contracts and state persistence in `actions/greet.ts`:

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
  count: number;
}

export default defineAction(async (input: GreetInput, ctx): Promise<GreetOutput> => {
  const prefix = ctx.config.get("GREETING_PREFIX", "Hello");
  const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
  await ctx.state.set(`greet:${input.name}`, count);
  ctx.log.info(`User ${input.name} has been greeted ${count} times`);

  return {
    message: `${prefix}, ${input.name}!`,
    count,
  };
});
```

### Writing an Operational Playbook

Define structured operational procedures in `playbooks/greet-user.md`:

```markdown
---
id: greet-user
description: User Greeting Standard Operating Procedure
actions:
  - sample.greet
---

# User Greeting Standard Operating Procedure

When greeting a user entering the session, follow these steps:

- Verify the user's name; do not use unverified nicknames.
- Invoke sample.greet to perform the greeting and retrieve historical visit counts.
- If visit count is greater than 1, add a warm welcome-back remark.
```

---

## Feature Comparison

| Feature & Dimension | ActionDock | mcp-use | FastMCP | Arcade MCP |
| :--- | :---: | :---: | :---: | :---: |
| Self-contained Node Delivery Build | Supported | — | — | — |
| In-Memory Sandbox & Self-Healing Testing | Supported | Supported | Supported | Supported |
| Decoupled SOP Playbook Guardrails | Supported | — | — | — |
| Self-Contained Agent Skill Export | Supported | — | — | — |
| Atomic Lockfile Dependency Management | Supported | — | — | — |
| Multi-Modal Delivery (CLI, MCP, HTTP, Skill) | Supported | Partial | Partial | Partial |
| Native MCP Protocol (STDIO & HTTP) | Supported | Supported | Supported | Supported |
| Remote HTTP Microservice Calling | Supported | Supported | Supported | Supported |
| Git-Native Plain Text Architecture | Supported | Supported | Supported | Supported |

---

## Monorepo Architecture

ActionDock is architected into 7 focused packages:

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│          Node.js CLI facade, dispatcher & envelope output   │
└──────────────┬──────────────┬───────────────┬───────────────┘
               │              │               │
               ▼              ▼               ▼
┌─────────────────────────────┐┌──────────────────────────────┐
│     @actiondock/mcp         ││    @actiondock/builder       │
│   MCP protocol & tasks      ││  Node build, npm pack & skill│
└──────────────┬──────────────┘└──────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/core                       │
│       Domain models, state machine, data locks & contracts  │
└───────┬─────────────────────────────┬───────────────┬───────┘
         │                             │               │
         ▼                             ▼               ▼
┌──────────────┐               ┌─────────────┐┌──────────────┐
│ runtime-node │               │   testing   ││     sdk      │
│Sync/Worker DB│               │In-memory test││Pure contract │
│& Node HTTP   │               │runtime & clock││Zero runtime  │
└──────────────┘               └─────────────┘└──────────────┘
```

- [@actiondock/cli](packages/cli/README.md): Unified CLI facade and dispatcher, providing command routing, envelope formatting, scaffolding, and build exports.
- [@actiondock/builder](packages/builder/README.md): Delivery package builder, providing directory build (`ad build`), npm packaging (`ad pack`), and Agent Skill export (`ad export skill`).
- [@actiondock/mcp](packages/mcp/README.md): MCP protocol adapter, offering STDIO and HTTP transports with task lifecycle management and cancellation propagation.
- [@actiondock/core](packages/core/README.md): Core domain engine, handling configuration loading, unified invocation facade, data directory locks, atomic dependency transactions, and runner state machines.
- [@actiondock/runtime-node](packages/runtime-node/README.md): Node.js runtime adapter, providing synchronous and worker SQLite drivers, native module loading, and native HTTP servers.
- [@actiondock/testing](packages/testing/README.md): Deterministic testing framework, providing virtual clocks, process mockers, memory storage, and test runtimes.
- [@actiondock/sdk](packages/sdk/README.md): Pure developer contract with zero runtime dependencies, exporting `defineAction` and core context interfaces.

---

## Verification and Testing

```bash
# Run all unit and integration tests
npm test

# Run TypeScript type check
npm run typecheck

# Build all packages
npm run build

# Run pack smoke test
npm run test:pack
```

---

## Documentation Center

For comprehensive architectural deep-dives, developer tutorials, and API reference manuals, visit the [Online Documentation](https://team4u.github.io/actiondock/) or explore the `docs/` folder:

- Getting Started:
  - [Overview and Mental Model](docs/getting-started/overview.md)
  - [Installation and Environment](docs/getting-started/installation.md)
  - [Five-Minute Quick Tour](docs/getting-started/five-minute-tour.md)
- Consumer Guide:
  - [Overview](docs/consumer/overview.md)
  - [Agent Skill Guide](docs/consumer/use-as-skill.md)
  - [IDE and Tool MCP Integration](docs/consumer/use-as-mcp.md)
  - [Node Delivery Running](docs/consumer/standalone-run.md)
  - [HTTP Microservice](docs/consumer/http-service.md)
  - [Configuration Injection](docs/consumer/configuration.md)
- Developer Guide:
  - [Quick Start](docs/developer/quick-start.md)
  - [First Action](docs/developer/first-action.md)
  - [Authoring Playbooks](docs/developer/playbooks.md)
  - [Testing and Sandbox](docs/developer/testing.md)
  - [Storage and Persistence](docs/developer/storage.md)
  - [Profiles](docs/developer/profiles.md)
  - [Build and Export](docs/developer/build-and-export.md)
- Cookbook & Recipes:
  - [External APIs and Auth](docs/cookbook/external-apis.md)
  - [Process Execution and Guardrails](docs/cookbook/process-execution.md)
  - [Long-Running Tasks and Progress](docs/cookbook/long-running-tasks.md)
  - [Composing Actions](docs/cookbook/composing-actions.md)
  - [AI-Driven Development](docs/cookbook/ai-agent-development.md)
- Concepts:
  - [Action Package](docs/concepts/action-package.md)
  - [Action Contract](docs/concepts/action.md)
  - [ActionContext](docs/concepts/action-context.md)
  - [Playbook Model](docs/concepts/playbook.md)
  - [Agent Skill Specification](docs/concepts/skill.md)
- Reference:
  - [CLI Reference](docs/reference/cli.md)
  - [actiondock.json Schema Specification](docs/reference/schema.md)
  - [Action SDK API Reference](docs/reference/action-api.md)
  - [Testing API Reference](docs/reference/testing-api.md)
  - [Config Resolution](docs/reference/config.md)
  - [Error Codes](docs/reference/error-codes.md)
  - [Migration Guide](docs/reference/v1-to-v2-migration.md)
- Architecture:
  - [Runtime Engine](docs/architecture/runtime.md)
  - [Channel Isolation](docs/architecture/stdout-stderr.md)
  - [Security Model](docs/architecture/security.md)

---

## License

Apache-2.0 License.
