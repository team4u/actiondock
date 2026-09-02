# @actiondock/sdk

The lightweight, zero-dependency SDK for defining, orchestrating, and testing AI Agent Actions and Skills in ActionDock 2.0.

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Runtime requirement**: [Bun](https://bun.sh/) >= 1.2.0 is required.

---

## Installation

```bash
bun add @actiondock/sdk
```

---

## Quick Example

### 1. Define an Action (`actions/greet.ts`)

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.greet",
  description: "Greet a user and track greeting count in persistent state",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
    },
    required: ["name"],
  },

  async run(input: { name: string }, ctx) {
    const greeting = ctx.config.get("GREETING_PREFIX", "Hello");
    const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
    await ctx.state.set(`greet:${input.name}`, count);
    ctx.log.info(`Greeted ${input.name} ${count} time(s)`);

    return {
      message: `${greeting}, ${input.name}!`,
      count,
    };
  },
});
```

### 2. Test in Milliseconds (`tests/greet.test.ts`)

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import greetAction from "../actions/greet";

describe("sample.greet Action", () => {
  it("greets user and updates state counter", async () => {
    const runtime = createTestRuntime({
      config: { GREETING_PREFIX: "Welcome" },
      state: { "greet:Alice": 2 },
    });

    const result = await runtime.run(greetAction, { name: "Alice" });
    expect(result.message).toBe("Welcome, Alice!");
    expect(result.count).toBe(3);
    expect(await runtime.state.get("greet:Alice")).toBe(3);
  });
});
```

---

## Core Capabilities

- `ActionContext`:
  - `ctx.config`: 5-tier configuration resolution (`override > sqlite > env > default > fallback`)
  - `ctx.state`: Embedded SQLite state store with namespace and TTL support
  - `ctx.actions`: Inter-action invocation with cycle detection
  - `ctx.log`: Isolated logging directed to `stderr`
  - `ctx.signal`: Cooperative cancellation via `AbortSignal`
- `execCli`: Deadlock-safe, cross-platform synchronous CLI executor with Windows `.cmd` resolution, stdin streaming, timeout, and signal support.
- `spawnDetached`: Safe asynchronous launcher for daemon-spawning CLI tools (e.g., `agent-browser open`), preventing pipe EOF hangs via fire-and-forget stdio decoupling and polling probe.
- `createTestRuntime`: Fast, zero-dependency in-memory test harness for unit tests.

---

## API Summary

| Export | Type | Description |
|---|---|---|
| `defineAction(def)` | Function | Defines and defensively validates an Action |
| `createTestRuntime(opts)` | Function | Creates an in-memory test runner (`config`, `state`, `logger`, `run()`) |
| `execCli(cmd, args, opts)` | Function | Synchronous, deadlock-safe CLI execution utility |
| `spawnDetached(opts)` | Function | Safe asynchronous launcher & readiness prober for daemon-spawning CLI tools |
| `MemoryConfig` | Class | In-memory `Config` provider for unit tests |
| `MemoryStateStore` | Class | In-memory `StateStore` with TTL and namespace support |
| `MemoryLogger` | Class | In-memory `Logger` collecting log entries for test assertions |
| `ActionContext` | Interface | Runtime context provided to `action.run(input, ctx)` |
| `ActionDefinition` | Interface | Schema and execution contract for an Action |
| `ExecutionResult` | Type | Standard JSON envelope (`ok: true, data` or `ok: false, error`) |

---

## 📖 Documentation

For detailed guides, design principles, and exhaustive API references, see the [ActionDock Documentation Center](../../docs/README.md):

- [Action SDK API Reference](../../docs/reference/action-api.md)
- [ActionContext Concept](../../docs/concepts/action-context.md)
- [Testing & Verification Guide](../../docs/developer/testing.md)

---

## License

[Apache-2.0](../../LICENSE) © team4u
