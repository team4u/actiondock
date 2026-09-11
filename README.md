# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

English | [简体中文](file:///root/code/action-dock/README.zh-CN.md)

Build Agent Tools once. Run them anywhere.

A TypeScript toolchain for building, testing, and shipping AI Agent tools as MCP servers, Agent Skills, HTTP services, or Node.js delivery directories.

```text
TypeScript Action
       │
       ├── ad run          # Local CLI execution
       ├── ad test         # In-memory fast testing
       ├── ad mcp          # STDIO / HTTP MCP server
       ├── ad serve        # Remote HTTP service
       ├── ad export skill # Self-contained Agent Skill (--mode source or --mode node)
       ├── ad pack         # npm tarball packaging (.tgz)
       └── ad build        # Node.js delivery directory build
              ↓
      runnable package
```

---

## Why ActionDock?

In an era where AI writes most of the code, the bottleneck of tool development is no longer typing boilerplate glue code—it is deterministic execution, self-healing quality, and zero-maintenance delivery.

Ad-hoc scripts easily break due to missing dependencies, unpinned runtimes, or out-of-order execution. Generic wrapper libraries simply expose APIs to models without guardrails, leading to hallucinations and unexpected destructive actions.

ActionDock establishes Agent Tools as industrial-grade software assets:

- Humans Define SOPs, Agents Write Implementation: Humans establish operational boundaries, sequence constraints, and safety guardrails in Playbooks; AI agents write the deterministic Action implementations against contracts.
- In-Memory Sandbox and Self-Healing Loop: Test Actions in an in-memory sandbox with deterministic clocks in milliseconds. When AI generates code, it can run automated tests and self-heal autonomously based on structured errors.
- Standard Node.js Delivery Format: Build an Action Package into a self-contained, runnable Node.js delivery directory with locked production dependencies or pack into standard npm packages.
- Build Once, Deliver Everywhere: The exact same Action runs seamlessly across CLI, MCP servers, HTTP microservices, and Agent Skills.
- Git-Native Plain Text Assets: Actions and Playbooks are plain text files designed for version control, code reviews, and CI/CD pipelines.
- Deterministic Lockfile and Atomic Dependency Management: Project dependencies are locked via actiondock.lock.json with atomic transaction rollbacks for ad add and ad remove.

---

## Runtime and Dependencies

ActionDock 2.0 provides an upgraded native runtime architecture:

- Native Node 24 Runtime: Natively runs on Node.js >=24.12.0, utilizing node:sqlite, node:http, and native type stripping. Standard authoring, testing, CLI execution, MCP servers, and HTTP services run directly on Node.js.
- Standard npm Workflow: Daily development, testing, building, and publishing use the standard npm workflow (npm test, npm run typecheck, npm run build, npm run test:pack).
- Cross-Environment Verification: Retains bun test as a cross-environment compatibility test.

---

## Deterministic Dependency Management

ActionDock 2.0 establishes [actiondock.lock.json](file:///root/code/action-dock/packages/core/src/project/lockfile.ts) (lockfileVersion: 1) as the deterministic lockfile for tool dependencies:

- Atomic Transactions: The `ad add` and `ad remove` commands take snapshot backups of `package.json`, `actiondock.json`, and `actiondock.lock.json`. If installation fails, changes are automatically rolled back.
- Elimination of Manifest Side Effects: The deprecated `actiondock.manifest.json` and standalone single-file binary compiler (`BunCompiler`) have been removed in favor of direct Node.js directory builds and npm distribution.

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

         Agent Skill Package
```

### Define an Action

In `actions/greet.ts`:

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
  ctx.log.info(`User ${input.name} greeted ${count} time(s)`);

  return {
    message: `${prefix}, ${input.name}!`,
    count,
  };
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

- Verify the user name; never assume unverified nicknames.
- Execute `sample.greet` to perform the greeting and read the count.
- If the count exceeds 1, acknowledge the returning user.
```

---

## Feature Comparison

| Capability / Dimension | ActionDock | mcp-use | FastMCP | Arcade MCP |
| :--- | :---: | :---: | :---: | :---: |
| Self-Contained Node Directory Build | Supported | — | — | — |
| In-Memory Sandbox & Self-Healing Testing | Supported | Supported | Supported | Supported |
| Procedure & Guardrail Decoupling (Playbook) | Supported | — | — | — |
| Self-Contained Agent Skill Export | Supported | — | — | — |
| Atomic Lockfile Dependency Management | Supported | — | — | — |
| Multimodal Delivery (CLI, MCP, HTTP, Skill) | Supported | Partial | Partial | Partial |
| MCP Protocol Native (STDIO & HTTP) | Supported | Supported | Supported | Supported |
| Remote HTTP Service Dispatch | Supported | Supported | Supported | Supported |
| Git-Native Plain Text Asset Model | Supported | Supported | Supported | Supported |

---

## Architecture and Layering

ActionDock 2.0 adopts a 7-package modular architecture:

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│   Node.js Facade CLI, Standalone Dispatcher & Envelopes     │
└──────────────┬──────────────┬───────────────┬───────────────┘
               │              │               │
               ▼              ▼               ▼
┌─────────────────────────────┐┌──────────────────────────────┐
│     @actiondock/mcp         ││    @actiondock/builder       │
│  MCP Protocol & Async Tasks ││ Node Build, Pack & Exporter  │
└──────────────┬──────────────┘└──────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/core                       │
│    Domain Model, ActionRunner, Lockfile & Target Facades    │
└───────┬─────────────────────────────┬───────────────┬───────┘
        │                             │               │
        ▼                             ▼               ▼
┌──────────────┐               ┌─────────────┐┌──────────────┐
│ runtime-node │               │   testing   ││     sdk      │
│Worker SQLite │               │Deterministic││Zero-Dep Dev  │
│& Node 24 ESM │               │Test Harness ││Contract      │
└──────────────┘               └─────────────┘└──────────────┘
```

- [@actiondock/cli](file:///root/code/action-dock/packages/cli/README.md): The command line toolchain running on Node.js >=24.12.0, coordinating project initialization, dependencies, execution, testing, building, and exporting with structured envelope rendering.
- [@actiondock/builder](file:///root/code/action-dock/packages/builder/README.md): Build planning and delivery package, providing Node.js directory builds (`ad build`), npm packaging (`ad pack`), and skill export (`ad export skill` supporting `--mode source` and `--mode node`).
- [@actiondock/mcp](file:///root/code/action-dock/packages/mcp/README.md): MCP adapter providing STDIO and HTTP protocol transports, supporting collaborative cancellation and Tasks extensions.
- [@actiondock/core](file:///root/code/action-dock/packages/core/README.md): Core domain kernel providing [ActionDockTarget](file:///root/code/action-dock/packages/core/src/target/types.ts) unified invocation facade, data directory locks ([DataDirLock](file:///root/code/action-dock/packages/core/src/storage/data-dir-lock.ts)), and transaction management.
- [@actiondock/runtime-node](file:///root/code/action-dock/packages/runtime-node/README.md): Node.js runtime adapter providing the default NodeSqliteDriver (with an optional standalone WorkerSqliteDriver), process execution, native type stripping loader, and HTTP servers.
- [@actiondock/testing](file:///root/code/action-dock/packages/testing/README.md): Standalone deterministic test framework offering [FakeClock](file:///root/code/action-dock/packages/testing/src/clock.ts), [MockProcessExecutor](file:///root/code/action-dock/packages/testing/src/process.ts), [MemoryStorage](file:///root/code/action-dock/packages/testing/src/storage.ts), and [createTestRuntime](file:///root/code/action-dock/packages/testing/src/runtime.ts).
- [@actiondock/sdk](file:///root/code/action-dock/packages/sdk/README.md): Minimal zero-dependency developer contract exporting `defineAction`, `ActionContext`, and core types.

---

## Verification and Testing

```bash
# Run all unit and integration tests
npm test

# Run full TypeScript type checks
npm run typecheck

# Build all packages
npm run build

# Run pack smoke test
npm run test:pack

# Cross-environment compatibility verification
bun test
```

---

## License

Apache-2.0 License.
