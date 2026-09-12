# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[Documentation](https://team4u.github.io/actiondock/) | English | [简体中文](README.zh-CN.md)

Build Agent Tools once. Run them anywhere.

An engineering toolchain for developing, testing, building, and distributing AI Agent Actions and Skills. Seamlessly deliver atomic capabilities as MCP protocol servers, Agent Skills, HTTP microservices, or self-contained Node.js delivery directories.

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

When agents generate code, the primary challenges are deterministic execution, reproducible delivery, and testable boundaries. Ad-hoc scripts break under environment drift, while exposing raw functions without guardrails risks unintended side effects.

ActionDock treats Agent Tools as testable, reliable software assets:

- Separated Boundaries: Humans define operational sequences and safety guardrails in Playbooks; agents implement deterministic Actions against typed contracts.
- In-Memory Sandbox: Test Actions with deterministic virtual clocks in milliseconds for automated test-and-repair loops.
- Reproducible Delivery: Build self-contained Node.js delivery packages with locked dependencies or export directly as Agent Skills.
- Write Once, Deliver Anywhere: The same Action runs across CLI, MCP servers, HTTP microservices, and Agent Skills.

---

## Runtime and Dependencies

ActionDock natively targets Node.js >=24.12.0:

- Native Runtime Engine: Powered by Node.js native type stripping, built-in SQLite (`node:sqlite`), and native HTTP without external build tools.
- Standard npm Workflow: Fully aligned with standard ecosystem tooling (`npm test`, `npm run typecheck`, `npm run build`, `npm run test:pack`).

---

## Quick Start

### For AI Agents

Compatible agents can install ActionDock skills directly:

```bash
# Install ActionDock official skill globally
npx skills add team4u/actiondock -g -y

# Or install any skill repository from GitHub
npx skills add <owner/repo> -g -y
```

Once installed, compatible agents can discover the bundled Playbooks and use them to invoke the corresponding Actions.

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
 
Define standard operating procedures in pure Markdown within `playbooks/greet-user.md`:

```markdown
# User Greeting Standard Operating Procedure

When greeting a user entering the session, follow these steps:

- Verify the user's name; do not use unverified nicknames.
- Invoke sample.greet to perform the greeting and retrieve historical visit counts.
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
        "sample.greet"
      ]
    }
  }
}
```

---

## Why ActionDock?

```text
One Action Package
├─ typed Actions
├─ human-readable Playbooks
├─ deterministic tests
├─ reproducible dependencies
└─ multiple delivery targets
   ├─ CLI
   ├─ MCP
   ├─ HTTP
   ├─ Agent Skill
   └─ standalone Node.js
```

- Decoupled SOP Guardrails: Keep operational constraints and safety boundaries out of code, defined as plain-text Playbooks for human oversight.
- Native In-Memory Sandbox: Fast, deterministic test runtime with virtual clocks and zero external database or network dependencies.
- Multi-Target Delivery: Develop once and deliver across CLI, MCP server, HTTP microservice, Agent Skill, or standalone Node.js package.
- Reproducible Dependencies: Deterministic lockfile resolution with transactional rollback protection on package installation and removal.

---

## Monorepo Architecture

ActionDock is organized as a seven-package monorepo:

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

See [Architecture](docs/architecture/runtime.md) for package responsibilities.

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
