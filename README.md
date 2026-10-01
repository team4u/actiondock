# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[Documentation](https://team4u.github.io/actiondock/) | English | [简体中文](README.zh-CN.md)

Write once. Deliver as CLI, MCP, HTTP, and Agent Skill.

An engineering toolchain for developing, testing, building, and distributing AI agent actions and skills. Built-in in-memory testing sandboxes, persistent state, config fallback, run tracking, and reproducible packaging.

```bash
# Install official skill for AI agents (Cursor, Claude Code, Antigravity)
npx skills add team4u/actiondock -g -y

# Or install CLI toolchain globally and initialize
npm install -g @actiondock/cli
ad init hello && cd hello

# Scaffold Action and generate typed contracts
ad action create greet --input name:string --output message:string

# Run sub-second in-memory sandbox tests
ad test

# Verify execution locally
ad run greet -- name=World

# Multi-target instant delivery
ad mcp          # MCP server (for Cursor, Windsurf, Claude Desktop)
ad serve        # RESTful HTTP microservice (:8080)
ad export skill # Agent skill bundle (for Claude Code, Codex, Antigravity)
```

---

## Key Features

- **Contract-Driven Development**: Treats Action as the sole product atom. Scaffolds typed contracts automatically without manual JSON Schema authoring.
- **Deterministic Testing Sandbox**: In-memory testing sandboxes and virtual clocks allow full test execution without spinning up external dependencies.
- **Write Once, Deliver Anywhere**: Author business logic once, and instantly ship as CLI, MCP protocol server, RESTful HTTP microservice, or Agent Skill asset.
- **Modern Native Runtime**: Built natively on Node.js 24+ type stripping, `node:sqlite` embedded storage, and `node:http` microservice engine with zero transpilation overhead.
- **Human Playbooks & Guardrails**: Pairs plain Markdown operational SOPs with atomic Actions to define workflows and enforce strict safety boundaries.

---

## Quick Start

- Install official Agent Skill (recommended for AI agents):
  Equip your AI programming agents (such as Cursor, Claude Code, Codex, Antigravity) to write, test, and ship Actions autonomously:
  ```bash
  npx skills add team4u/actiondock -g -y
  ```

- Install CLI and initialize project:
  ```bash
  npm install -g @actiondock/cli
  ad init hello
  cd hello
  ```

- Scaffold an Action:
  CLI parses field declarations, creates typed contracts, and updates manifest:
  ```bash
  ad action create greet --input name:string --output message:string
  ```

- Implement business logic:
  Consume generated types directly in `actions/greet.ts`:
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

- Test and run locally:
  ```bash
  # Execute in-memory sandbox tests
  ad test

  # Run locally via CLI
  ad run greet -- name=World
  ```

- Multi-target instant delivery:
  ```bash
  # Standard MCP protocol server
  ad mcp

  # Production RESTful HTTP microservice
  ad serve

  # Self-contained Agent Skill bundle
  ad export skill
  ```

---

## Packages

ActionDock is structured as a modular monorepo:

| Package | Purpose |
| --- | --- |
| `@actiondock/sdk` | Minimal core SDK and types (`defineAction`, `ActionContext`) with zero dependencies |
| `@actiondock/core` | Native runtime drivers, unified facade, standard port models, and storage |
| `@actiondock/cli` | CLI toolchain, dispatcher, flat argument parser, and execution facade |
| `@actiondock/mcp` | Model Context Protocol adapter, tool exposure, and cancellation pipeline |
| `@actiondock/builder` | Dependency planning, directory build, npm packaging, and Agent Skill exporter |
| `@actiondock/testing` | Deterministic in-memory sandbox, fake clocks, and testing runtime |

---

## Documentation

For full guides and references, visit the [Documentation Center](https://team4u.github.io/actiondock/) or explore local guides:

- [System Overview](docs/getting-started/overview.md)
- [Quick Start](docs/getting-started/quick-start.md)
- [Action Development Guide](docs/developer/first-action.md)
- [Playbook Authoring](docs/developer/playbooks.md)
- [Consumer Guide](docs/consumer/overview.md)
- [CLI Reference](docs/reference/cli.md)
- [Architecture Guide](docs/architecture/runtime.md)

---

## License

Apache-2.0 License.
