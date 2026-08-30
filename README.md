# ActionDock 2.0

> **Build once. Ship standalone Actions that AI Agents can run anywhere.**

ActionDock 2.0 is a lightweight, zero-daemon developer toolchain for building, testing, and distributing AI Agent Actions and Skills using **Bun + TypeScript**.

Unlike legacy server-centric platforms, ActionDock produces **zero-install standalone executables** bundled alongside markdown `SKILL.md` instructions. End users and AI agents do not need to install ActionDock, Bun, Node, Python, or Java.

---

## 🌟 Key Features

* **Zero-Install Distribution**: Packages compile into single self-contained executables via Bun.
* **Filesystem First**: Actions (`actions/*.ts`), Playbooks (`playbooks/*.md`), and configs are ordinary files tracked in Git.
* **TypeScript Native**: Write actions with full type safety and import-based composition.
* **Built-in Storage**: Embedded SQLite store (`bun:sqlite`) provides persistent Config, Shared State, and execution Run records.
* **Standard JSON Schema**: Input and output schemas use standard JSON Schema validated with `Ajv`.
* **Agent-Friendly CLI**: Every command provides predictable JSON outputs on `stdout` and logs on `stderr`.

---

## 🚀 Quick Start

### 1. Initialize a new project
```bash
bun x @actiondock/cli init my-tools
cd my-tools
```

### 2. Create an Action
```bash
actiondock action create greet.user --desc "Greet a user with custom message"
```
Or directly edit `actions/user.ts`:
```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "greet.user",
  description: "Greet a user with custom message",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  },

  async run(input: { name: string }, ctx) {
    const greeting = ctx.config.get("GREETING", "Hello");
    const count = ((await ctx.state.get<number>("count")) || 0) + 1;
    await ctx.state.set("count", count);

    ctx.log.info(`Greeting ${input.name} (times: ${count})`);
    return {
      message: `${greeting}, ${input.name}!`,
    };
  },
});
```

### 3. Run and Debug in Development
```bash
actiondock action run greet.user --input '{"name": "Alice"}'
```

### 4. Build Standalone Executable
```bash
actiondock build
```

### 5. Export Standalone Skill
```bash
actiondock export skill
```

Output:
```text
dist/my-tools-skill/
├── SKILL.md                  # LLM task instruction guide
├── actiondock.skill.json     # Skill manifest
├── playbooks/                # Task SOP markdown files
└── bin/
    └── my-tools              # Standalone binary (no Bun / Node needed)
```

---

## 📚 Documentation & Guides

* **[Action Authoring Guide](file:///root/code/action-dock/docs/action-authoring.md)**: Deep dive into Action definition, `ActionContext` API (`config`, `state`, `actions`, `log`), JSON schemas, and testing.
* **[CLI Reference](file:///root/code/action-dock/docs/cli-reference.md)**: Complete CLI command catalog, flags, and usage examples.
* **[ActionDock AI Agent Skill](file:///root/code/action-dock/skills/actiondock/SKILL.md)**: Specialized instruction skill for AI coding assistants and agents.
* **[Architecture Design Document](file:///root/code/action-dock/ActionDock_2.0_Design.md)**: Complete 2.0 system architecture and design principles.

---

## 🛠️ CLI Reference Summary

| Command | Description |
| :--- | :--- |
| `actiondock init [dir]` | Scaffold a new ActionDock project |
| `actiondock info [--json]` | Show project metadata, actions, and playbooks |
| `actiondock action create <id>` | Scaffold a new Action definition file |
| `actiondock action list [--json]` | List discovered actions |
| `actiondock action show <id> [--json]` | Inspect action schema and description |
| `actiondock action run <id> --input '<json>'` | Execute an action with JSON input |
| `actiondock action validate` | Validate action schemas and definitions |
| `actiondock playbook create <id>` | Scaffold a new Playbook markdown file |
| `actiondock playbook list / show <id>` | Inspect task SOP playbooks |
| `actiondock config list / get / set / delete` | Manage local config store |
| `actiondock state list / get / set / delete` | Inspect and manage shared state store |
| `actiondock runs list / show <run-id>` | Inspect execution run history |
| `actiondock test` | Run tests with Bun test runner |
| `actiondock build [--target <target>]` | Compile project into standalone executable |
| `actiondock export skill [--target <target>]` | Export standalone skill bundle |

---

## 📦 Monorepo Structure

* [`packages/sdk`](file:///root/code/action-dock/packages/sdk): `@actiondock/sdk` minimal public SDK & runtime types (`defineAction`, `createTestRuntime`). Zero heavyweight dependencies.
* [`packages/core`](file:///root/code/action-dock/packages/core): `@actiondock/core` domain engine implementing project discovery, action execution runtime, SQLite storage, JSON Schema validation, standalone compilation builder, and skill exporter.
* [`packages/cli`](file:///root/code/action-dock/packages/cli): `@actiondock/cli` developer command-line facade toolchain.
* [`examples/github-tools`](file:///root/code/action-dock/examples/github-tools): Complete sample project demonstrating action composition, state checkpoints, and skill export.

---

## 🧪 Testing & Verification

```bash
# Run all tests across monorepo
bun test

# Run TypeScript type check
bun run typecheck
```

---

## License

Apache-2.0
