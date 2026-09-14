# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[Documentation](https://team4u.github.io/actiondock/) | English | [简体中文](README.zh-CN.md)

Agent Tool Engineering Toolchain.

Turn agent-generated tool code into testable, constrained, reproducible, and shippable production software assets.

## Write Once. Run Anywhere.

Action is the single atomic core of ActionDock. Operational Playbooks, portable Agent Skills, standard MCP protocol servers, and production RESTful HTTP microservices are all enhancements and delivery targets centered around Action.

### 10-Line Atomic Action Definition

Write pure business logic in `actions/greet.ts` with native TypeScript type inference and execution context:

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
}

export default defineAction<GreetInput, GreetOutput>(async (input, ctx) => {
  ctx.log.info("Greeting user", input);
  return {
    message: `Hello, ${input.name}!`,
  };
});
```

### Instant Multi-Target Delivery

Deliver the exact same Action code into multiple production targets without writing any glue code:

```text
actions/greet.ts (typed Action implementation)
       │
       ├── ad test         --> [PASS] Millisecond in-memory sandbox & virtual clock
       ├── ad run          --> [OUTPUT] Immediate local CLI execution
       ├── ad mcp          --> [READY] Standard MCP protocol communication server
       ├── ad export skill --> [EXPORT] Self-contained Agent Skill (Playbook & locked deps)
       └── ad serve        --> [READY] Production RESTful microservice
```

### Production-Grade Reliability

- In-memory sandbox and self-healing: Millisecond virtual clocks and memory-isolated testing allow agents to run unit tests autonomously and self-heal failures in a closed loop.
- Decoupled operational guardrails: Humans define workflow sequences, decision branches, and safety guardrails in plain-text Markdown Playbooks; agents implement deterministic Actions against strict type schemas.
- Deterministic dependency reproduction and transactional rollback: Deterministic lockfiles and transactional dependency snapshots prevent drift and allow safe rollbacks during installation or removal.
- Single source of truth: Maintain a platform-neutral business core, decoupled from transport protocols and host environments.

---

## Frequently Asked Questions

- What is ActionDock?
  ActionDock is an engineering toolchain for developing, testing, building, and distributing AI agent actions and skills. With Action as its sole product atom, ActionDock transforms fragile, ad-hoc scripts into robust, well-structured, production-grade software assets.

- Why is it better than writing MCP directly?
  Authoring raw MCP servers or ad-hoc scripts exposes production systems to three critical risks: lack of deterministic in-memory test sandboxes, fragile runtime dependency drift, and unintended agent hallucinations or destructive actions due to missing human guardrails. ActionDock does not replace the MCP protocol; it serves as the upstream engineering foundation. It delivers built-in in-memory unit test sandboxes, decoupled human-defined Playbook guardrails, and deterministic dependency management with transactional rollback. The same Action can be delivered as an MCP server, HTTP microservice, Agent Skill, or CLI tool without altering a single line of business logic.

- How simple is it?
  Install the `@actiondock/cli` command-line tool and author pure business functions using `defineAction`. The framework handles protocol encoding, transport multiplexing, state persistence, and logging out of the box without boilerplate.

- How to get started?
  Follow the five-step golden path below to go from scaffold initialization to multi-target delivery in two minutes.

---

## Golden Development Path

Developing and delivering a production-grade Action follows five straightforward steps:

- Initialize project scaffold:
  Run the initialization command to create a project scaffold and install dependencies:
  ```bash
  ad init hello-tools
  cd hello-tools
  npm install
  ```

- Scaffold an Action:
  Generate a strongly typed Action skeleton and its manifest declaration:
  ```bash
  ad action create greet -d "Greeting action"
  ```

- Write business logic:
  Implement your core business logic in `actions/greet.ts` with complete type safety and context access.

- Local verification and automated testing:
  Execute fast in-memory unit tests and verify execution locally via CLI:
  ```bash
  # Run the unit test suite
  npm test

  # Execute the Action locally via CLI
  ad run greet --input '{"name":"ActionDock"}'
  ```

- Multi-target delivery and export:
  Deliver as an MCP protocol server or export as a self-contained portable Agent Skill based on your needs:
  ```bash
  # Launch as a standard MCP server
  ad mcp

  # Export as a self-contained Agent Skill
  ad export skill
  ```

---

## Runtime and Native Engineering Benefits

ActionDock natively targets Node.js >=24.12.0. This runtime threshold is intentionally chosen to provide substantial native engineering advantages:

- Native TypeScript type stripping: Execute TypeScript files directly without Babel, esbuild, swc, or ts-node compilation and transpilation pipelines.
- Built-in SQLite engine: Leverage `node:sqlite` for lightweight embedded state storage and test sandboxing without compiling native binary extensions or installing external database packages.
- Native HTTP server: Utilize `node:http` to power microservices and endpoints with minimal runtime overhead and zero third-party web framework dependencies.
- Zero transpilation and minimal footprint: Direct execution from local development to production distribution, keeping workflows lean, fast, and dependency-free.

---

## Human-Defined Guardrails, Agent-Authored Implementation

ActionDock establishes a clear boundary between human intent and agent autonomous implementation:

- Humans write operational Playbooks: Define operational sequences, branching criteria, and safety guardrails in plain-text Markdown as the single source of truth for human intent.
- Agents write atomic Actions: Implement deterministic capabilities satisfying strongly typed contracts, completing autonomous verification and self-healing through test suites.

```text
Playbook = Human-defined SOPs (workflow sequences, branches, guardrails)
Action   = Agent-implemented code (strongly typed contracts, atomic capabilities)

             ↓ Unified Delivery

          Agent Skill portable package / MCP protocol server / HTTP microservice
```

### Operational Playbook Example

Author standard operating procedures in plain Markdown within `playbooks/greet-user.md`:

```markdown
# User Greeting Standard Operating Procedure

When greeting a user entering the session, follow these steps:

- Verify the user's name; do not use unverified nicknames.
- Invoke greet to perform the greeting and retrieve historical visit counts.
- If visit count is greater than 1, add a warm welcome-back remark.
```

Declare playbook metadata and its associated actions in `actiondock.json`:

```json
{
  "playbooks": {
    "greet-user": {
      "entry": "playbooks/greet-user.md",
      "description": "User Greeting Standard Operating Procedure",
      "actions": [
        "greet"
      ]
    }
  }
}
```

---

## Monorepo Architecture

ActionDock is organized as a cohesive, layered monorepo:

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

See [Architecture](docs/architecture/runtime.md) for detailed package responsibilities and layer designs.

---

## Verification and Commands

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

## Documentation

Visit the [Documentation Center](https://team4u.github.io/actiondock/) or explore the key guides:

- [Getting Started](docs/getting-started/overview.md)
- [Developer Guide](docs/developer/first-action.md)
- [Consumer Guide](docs/consumer/overview.md)
- [API Reference](docs/reference/action-api.md)
- [Architecture](docs/architecture/runtime.md)
- [Contributing](docs/developer/contributing.md)

---

## License

Apache-2.0 License.
