# ActionDock

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-81%20passed-brightgreen.svg)](https://github.com/team4u/actiondock)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**English** | [简体中文](README.zh-CN.md)

**Build Agent Tools once. Run them anywhere.**

A TypeScript toolchain for building, testing, and shipping AI Agent tools as **MCP servers, Agent Skills, HTTP services, or standalone binaries**.

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
        standalone binary
```

---

## Why ActionDock?

Agent tools are becoming real software.

They need schemas, tests, version control, reproducible builds, and multiple distribution targets — not another copy of the same business logic for every Agent runtime.

ActionDock treats an Agent Tool as a software artifact:

* **Code as Contract** — TypeScript + JSON Schema define the implementation and tool contract together with automatic runtime validation.
* **Testable by Default** — Test Actions in an in-memory runtime in milliseconds without starting an MCP server or mocking complex networks.
* **Build Once** — The same Action runs seamlessly through CLI, MCP, HTTP, and standalone executables.
* **Portable Distribution** — Compile an Action Package into a single standalone binary with zero dependencies (no Node.js or Bun required on target machines).
* **Agent Skills** — Combine deterministic Actions with operational Playbooks and export them as self-contained Agent Skills.
* **Git Native** — Actions and Playbooks are plain files designed for code review, branching, and CI/CD pipelines.

---

## Quick Start

### For AI Agents (Install Skills from GitHub)

ActionDock is built as a tool foundation for AI Agents. Agents (such as Claude Code, Cursor, Antigravity, and GitHub Copilot CLI) can directly install skills from GitHub repositories using `npx skills`:

```bash
# Install ActionDock skill globally for your agent (-g for global install, -y for automatic confirmation)
npx skills add team4u/actiondock -g -y

# Or install any skill globally from GitHub
npx skills add <owner/repo> -g -y
```

Once installed, your agent automatically discovers the skill SOPs and executes actions. See [Agent Skill Usage Guide](docs/consumer/use-as-skill.md).

### For Tool Developers (Build & Ship Actions)

> **Runtime requirement**: [Bun](https://bun.sh/) >= 1.2.0.

#### Install CLI

```bash
# Install Bun runtime (if not already installed)
npm install -g bun

# Install ActionDock CLI
npm install -g @actiondock/cli
```

#### Initialize an Action Package

```bash
ad init hello-tools
cd hello-tools
bun install
```

#### Create an Action

Create `actions/hello.ts`:

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "hello",
  description: "Say hello to someone",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the person" },
    },
    required: ["name"],
  },

  async run(input) {
    return {
      message: `Hello ${input.name}!`,
    };
  },
});
```

#### Run, Test, and Deliver

- Run locally:
```bash
ad run hello --input '{"name":"ActionDock"}'
```

- Run in-memory tests:
```bash
ad test
```

- Serve as an MCP server (for Claude Code, Cursor, Windsurf):
```bash
ad mcp
```

- Compile to a zero-dependency standalone binary:
```bash
ad build
```

- Export as a portable Agent Skill:
```bash
ad export skill
```

> **One Action. Multiple runtimes. One contract.**

---

## Action + Playbook

ActionDock separates **capability** from **procedure**:

```text
Action   = what an Agent can do
Playbook = how an Agent should do it

             ↓

        Agent Skill
```

For example:

```text
actions/
├── get-pr.ts
├── create-comment.ts
└── merge-pr.ts

playbooks/
└── review-pr.md
```

- **Actions** provide deterministic, type-safe capabilities with strict input/output schemas.
- **Playbooks** describe higher-level procedures, constraints, guardrails, and operational knowledge for LLMs.
- Together, they form an **Action Package** that can be exported as a self-contained **Agent Skill**.

---

## Where ActionDock Fits

ActionDock is not an Agent framework or workflow canvas. It focuses specifically on the **development and delivery lifecycle of Agent Tools**.

```text
                 Agent / LLM
                     │
            ┌────────┴────────┐
            │                 │
         MCP Client       Agent Skill
            │                 │
            └────────┬────────┘
                     │
                ActionDock
                     │
        ┌────────────┼────────────┐
        │            │            │
      Action       Action       Action
        │            │            │
   Your APIs      Database    Services
```

---

## Build Once, Run Anywhere

```text
                  ┌─ CLI (`ad run`)
                  │
                  ├─ MCP (`ad mcp`)
actions/*.ts ─────┼─ HTTP (`ad serve`)
                  │
                  ├─ Agent Skill (`ad export skill`)
                  │
                  └─ Standalone Binary (`ad build`)
```

> **One implementation, multiple delivery targets.**

---

## How It Compares

| Capability / Dimension | ActionDock | mcp-use | FastMCP | Arcade MCP |
| :--- | :---: | :---: | :---: | :---: |
| **MCP Server (STDIO & HTTP)** | ✅ | ✅ | ✅ | ✅ |
| **TypeScript Native** | ✅ | ✅ | ✅ | ✅ / Python |
| **Pure In-Memory Tool Testing** | ✅ | ✅ | ✅ | ✅ |
| **Zero-Dependency Standalone Binary** | **✅** | — | — | — |
| **Agent Skill Export (with SOP)** | **✅** | — | — | — |
| **Playbook / Procedure Definition** | **✅** | — | — | — |
| **Remote HTTP Runner** | ✅ | ✅ | ✅ | ✅ |
| **Git-Native Package Architecture** | ✅ | ✅ | ✅ | ✅ |
| **Managed OAuth** | — | — | — | **✅** |
| **Managed Cloud Platform** | — | ✅ | — | **✅** |

---

## Distribution Targets

```text
Distribution Targets

✅ npm packages       (@actiondock/sdk, @actiondock/core, @actiondock/mcp, @actiondock/cli)
✅ Standalone Binary  (ad build -> self-contained executable)
✅ Agent Skill        (ad export skill -> portable skill bundle)
⬜ Docker             (Containerized image target - on roadmap)
```

---

## Codebase Architecture

ActionDock uses a modular monorepo structure:

```text
actiondock/
├── packages/
│   ├── sdk/          # @actiondock/sdk: Minimal SDK (defineAction, ActionContext, createTestRuntime)
│   ├── core/         # @actiondock/core: Engine (Runner, Storage, Schema, Build, Export)
│   ├── mcp/          # @actiondock/mcp: MCP Adapter (STDIO / HTTP / Tasks extension)
│   └── cli/          # @actiondock/cli: Command-line interface facade (ad)
├── examples/
│   └── github-tools/ # Complete example Action Package with Actions & Playbooks
└── docs/             # Technical documentation center
```

---

## Documentation

Visit the [Documentation Center](docs/README.md) for full guides:

- **Getting Started**
  - [Installation](docs/getting-started/installation.md)
  - [Core Overview & Dual Paths](docs/getting-started/overview.md)
- **Consumer Guide**
  - [Overview](docs/consumer/overview.md)
  - [Agent Skill Usage Guide](docs/consumer/use-as-skill.md)
  - [Use as MCP Server](docs/consumer/use-as-mcp.md)
  - [Standalone Binary Run](docs/consumer/standalone-run.md)
  - [HTTP Service](docs/consumer/http-service.md)
  - [Configuration & Credentials](docs/consumer/configuration.md)
- **Developer Guide**
  - [Quick Start](docs/developer/quick-start.md)
  - [First Action](docs/developer/first-action.md)
  - [Playbooks](docs/developer/playbooks.md)
  - [Testing & Verification](docs/developer/testing.md)
  - [Storage & Persistence](docs/developer/storage.md)
  - [Profiles & Remote Dispatch](docs/developer/profiles.md)
  - [Build & Skill Export](docs/developer/build-and-export.md)
- **Core Concepts**
  - [Action Package](docs/concepts/action-package.md) *(The core architectural abstraction)*
  - [Action](docs/concepts/action.md)
  - [ActionContext](docs/concepts/action-context.md)
  - [Playbook](docs/concepts/playbook.md)
  - [Agent Skill](docs/concepts/skill.md)
- **Reference**
  - [CLI Reference](docs/reference/cli.md)
  - [Configuration Resolution](docs/reference/config.md)
  - [SDK Action API](docs/reference/action-api.md)
  - [Error Codes & Diagnostics](docs/reference/error-codes.md)
  - [1.0 to 2.0 Migration Guide](docs/reference/v1-to-v2-migration.md)
- **Architecture**
  - [Runtime Engine](docs/architecture/runtime.md)
  - [Stdout/Stderr Physical Isolation](docs/architecture/stdout-stderr.md)
  - [Security Hardening](docs/architecture/security.md)

---

## Verification & Testing

```bash
# Run all unit and integration tests
bun test

# Run full TypeScript type checks
bun run typecheck
```

---

## License

Apache-2.0 License. See [LICENSE](LICENSE) for details.
