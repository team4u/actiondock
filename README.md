# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[Documentation](https://team4u.github.io/actiondock/) | English | [简体中文](README.zh-CN.md)

Write once. Deliver as CLI, MCP, HTTP, and Agent Skill.

Built-in testing sandbox, persistent state, config fallback, run tracking, and reproducible packaging.

```text
$ npm install -g @actiondock/cli
$ ad init hello && cd hello
[OK] Initialized ActionDock project in hello

$ ad action create greet --input name:string --output message:string
[OK] Created action greet (actions/greet.ts)
[OK] Generated contract types (.actiondock/generated/actions.d.ts)

$ ad test
[PASS] tests/greet.test.ts (1.2ms, in-memory sandbox)
1 passed, 0 failed

$ ad run greet --input '{"name":"World"}'
{
  "ok": true,
  "runId": "01JMB394K8V6C1T9A2",
  "data": { "message": "Hello, World!" }
}

$ ad mcp          --> [READY] Model Context Protocol (STDIO/SSE)
$ ad serve        --> [READY] RESTful HTTP Microservice (:8080)
$ ad export skill --> [EXPORT] Self-contained Agent Skill bundle
```

---

## 5-Minute Quick Start

No manual JSON Schema required. Five core commands guide you from scaffolding to multi-target delivery:

- Install CLI globally:
  ```bash
  npm install -g @actiondock/cli
  ```

- Initialize project scaffold:
  ```bash
  ad init hello
  cd hello
  ```

- Declare and scaffold Action:
  The CLI parses field types, generates typed contracts, and registers the manifest automatically:
  ```bash
  ad action create greet --input name:string --output message:string
  ```

- Write pure business logic:
  Implement business logic directly in `actions/greet.ts` with strongly typed contracts:
  ```ts
  import { defineAction } from "@actiondock/sdk";
  import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

  export type Input = ActionInput<"greet">;
  export type Output = ActionOutput<"greet">;

  export default defineAction<Input, Output>(async (input, ctx) => {
    ctx.log.info("Greeting user", input);
    return {
      message: `Hello, ${input.name}!`,
    };
  });
  ```

- Run sandbox test and local execution:
  Execute sub-second unit tests in the in-memory sandbox and verify outputs locally via CLI:
  ```bash
  # Execute in-memory sandbox tests
  ad test

  # Run locally via CLI (simple inline JSON)
  ad run greet --input '{"name":"World"}'

  # Pass complex parameters via JSON file or stdin to avoid shell escaping
  ad run greet --input-file input.json
  ```

- Multi-target instant delivery:
  Ship the exact same Action code into multiple production targets without writing glue code:
  ```bash
  # Launch as a standard MCP protocol server (for Cursor, Windsurf, or Claude Desktop)
  ad mcp

  # Launch as a production RESTful HTTP microservice
  ad serve

  # Export as a self-contained portable Agent Skill bundle
  ad export skill
  ```

---

## Why ActionDock

As AI generates more functional code, the core engineering bottlenecks shift toward determinism, guardrails, and low-maintenance delivery:

- More reliable than ad-hoc scripts: Ad-hoc scripts break easily from missing dependencies or environment drift. ActionDock provides in-memory testing sandboxes and closed-loop validation.
- Safer than exposed raw functions: Exposing naked functions directly to language models leads to sequence errors and unauthorized destructive operations. ActionDock uses human-defined Playbooks to enforce strict workflow bounds.
- More efficient than writing protocol glue: Traditional approaches require hand-crafting separate layers for CLI, MCP, and HTTP. ActionDock treats Action as the sole product atom, enabling write-once multi-target delivery.

---

## Advanced Features and Mechanics

### Contract Model and Manifest Single Source of Truth

The underlying `actiondock.json` serves as the single source of truth for project metadata and action manifests. Developers can let `ad action create` manage it automatically or configure it manually:

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "hello",
  "name": "Hello Tools",
  "version": "0.1.0",
  "actions": {
    "greet": {
      "entry": "actions/greet.ts",
      "description": "Greeting action",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"]
      }
    }
  }
}
```

Whenever the manifest changes, regenerate typed contracts with:

```bash
ad generate types
```

### Human Playbooks and Safety Guardrails

ActionDock maintains a strict division between human intent and autonomous agent implementation:

- Humans author operational Playbooks: Define operational steps, prerequisites, and safety boundaries in plain Markdown.
- Agents implement atomic Actions: Fulfill deterministic typed contracts and verify correctness using the in-memory testing sandbox.

```text
Playbook = Human-defined SOPs (workflow sequences, branches, guardrails)
Action   = Agent-implemented code (strongly typed contracts, atomic capabilities)

             ↓ Unified Delivery

          Agent Skill portable package / MCP protocol server / HTTP microservice
```

### State Persistence and Context Mechanism

Access core runtime primitives safely via `ActionContext`:

- Persistent state: Access embedded key-value storage through `ctx.state`.
- Configuration hierarchy: Retrieve environment variables and default values with fallback support via `ctx.config`.
- Channel isolation: Write diagnostic logs via `ctx.log`, redirecting to stderr to prevent contaminating stdout data payloads.
- Run tracking: Every execution receives a unique run identifier for lifecycle auditing and graceful cancellation.

### Modern Native Runtime Foundation

ActionDock natively targets Node.js >= 24.12.0 to unlock substantial native engineering advantages:

- Native type stripping: Run TypeScript code directly without Babel, esbuild, or compilation overhead.
- Native lightweight storage: Leverage built-in `node:sqlite` for embedded persistence without native binary compilation.
- Native HTTP server: Power microservices via built-in `node:http` without heavy web framework dependencies.
- Lean dependency tree: Eliminate bloated build tooling for an agile development lifecycle.

---

## Architecture and Monorepo Packages

ActionDock is structured as a cohesive, layered monorepo:

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│          Node.js CLI facade, dispatcher & envelope output   │
│    ad init / ad action create / ad test / ad run / ad mcp   │
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

---

## Frequently Asked Questions

- What is ActionDock?
  ActionDock is an engineering toolchain for developing, testing, building, and distributing AI agent actions and skills. With Action as its sole product atom, ActionDock transforms fragile scripts into robust, production-grade software assets.

- Why is it better than writing MCP directly?
  Raw MCP implementations lack deterministic testing sandboxes, suffer from runtime dependency drift, and lack human-defined guardrails. ActionDock provides upstream engineering guarantees and delivers the exact same code as MCP, HTTP, Agent Skill, or CLI targets without rewriting business logic.

- Do I need to write JSON Schema by hand?
  No. Running `ad action create` scaffolds typed schemas and updates project manifests automatically.

---

## Underlying Maintenance Commands

Commands for framework development and deep integration:

```bash
# Run all unit and integration tests
npm test

# Run TypeScript type checks
npm run typecheck

# Build all packages
npm run build

# Run package smoke tests
npm run test:pack
```

---

## Documentation

Visit the [Documentation Center](https://team4u.github.io/actiondock/) or explore the key guides:

- [System Overview](docs/getting-started/overview.md)
- [Quick Start](docs/getting-started/quick-start.md)
- [Action Development Guide](docs/developer/first-action.md)
- [Consumer Guide](docs/consumer/overview.md)
- [API Reference](docs/reference/action-api.md)
- [Architecture](docs/architecture/runtime.md)
- [Contributing](docs/developer/contributing.md)

---

## License

Apache-2.0 License.
