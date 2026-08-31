# @actiondock/sdk

The lightweight, zero-dependency SDK for defining, orchestrating, and testing AI Agent Actions and Skills in ActionDock 2.0.

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

---

## Features

- **Code as Contract**: Strongly-typed Action definitions with TypeScript generics and JSON Schema input/output validation.
- **Rich Context (`ActionContext`)**:
  - `ctx.config`: 5-tier hierarchical configuration reader (`CLI > SQLite > Global > ENV > default > fallback`).
  - `ctx.state`: Cross-action persistent state store with namespacing and automatic TTL expiration.
  - `ctx.actions`: Safe action-to-action composition with built-in recursion & cycle detection.
  - `ctx.log`: Clean stderr-directed structured logging (keeping stdout clean for JSON envelopes).
  - `ctx.signal`: Cooperative `AbortSignal` for graceful timeout and cancellation.
- **Enterprise `execCli`**:
  - Windows `.cmd`/`.bat` path resolution via `Bun.which`.
  - Anti-pipe-deadlock synchronous buffer draining via `Bun.spawnSync`.
  - Subprocess timeout, `AbortSignal`, stdin piping, and raw binary buffer outputs.
- **Zero-Dependency In-Memory Test Harness (`createTestRuntime`)**: Millisecond unit testing without spinning up databases or external processes.

---

## Installation

```bash
bun add @actiondock/sdk
# or
npm install @actiondock/sdk
```

---

## Quick Start

### 1. Define an Action

Create an action in `actions/greet.ts`:

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
  count: number;
}

export default defineAction({
  id: "sample.greet",
  description: "Greet a user and track greeting count in state",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
    },
    required: ["name"],
  },

  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      count: { type: "number" },
    },
    required: ["message", "count"],
  },

  async run(input: GreetInput, ctx): Promise<GreetOutput> {
    // 1. Read config (with fallback default)
    const greeting = ctx.config.get("GREETING_PREFIX", "Hello");

    // 2. Read and update state
    const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
    await ctx.state.set(`greet:${input.name}`, count);

    // 3. Stderr structured logging
    ctx.log.info(`Greeted ${input.name} ${count} time(s)`);

    return {
      message: `${greeting}, ${input.name}!`,
      count,
    };
  },
});
```

### 2. Test Your Action in Milliseconds

Create a unit test in `tests/greet.test.ts`:

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

    // Verify persisted state
    const savedCount = await runtime.state.get("greet:Alice");
    expect(savedCount).toBe(3);

    // Verify logs
    expect(runtime.logger.logs.length).toBe(1);
    expect(runtime.logger.logs[0].message).toContain("Greeted Alice 3 time(s)");
  });
});
```

---

## Action Composition (`ctx.actions.invoke`)

Actions can safely invoke other actions with automatic cycle detection:

```ts
import { defineAction } from "@actiondock/sdk";
import fetchUserAction from "./fetch-user";

export default defineAction({
  id: "composite.user-summary",
  async run(input: { userId: string }, ctx) {
    const user = await ctx.actions.invoke(fetchUserAction, { id: input.userId });
    return { summary: `User ${user.name} (${user.email})` };
  },
});
```

---

## Calling External CLI Tools (`execCli`)

`execCli` is designed specifically for agent actions executing shell binaries:

```ts
import { defineAction, execCli } from "@actiondock/sdk";

export default defineAction({
  id: "git.current-branch",
  run(_input, ctx) {
    const res = execCli("git", ["branch", "--show-current"], {
      signal: ctx.signal,
      timeout: 5000,
      throwOnError: true,
    });

    return { branch: res.stdout };
  },
});
```

---

## API Summary

| Export | Type | Description |
|---|---|---|
| `defineAction(def)` | Function | Defines and defensively validates an Action |
| `createTestRuntime(opts)` | Function | Creates an in-memory test runner (`config`, `state`, `logger`, `run()`) |
| `execCli(cmd, args, opts)` | Function | Synchronous, deadlock-safe CLI execution utility |
| `MemoryConfig` | Class | In-memory `Config` provider for unit tests |
| `MemoryStateStore` | Class | In-memory `StateStore` with TTL and namespace support |
| `MemoryLogger` | Class | In-memory `Logger` collecting log entries for test assertions |
| `ActionContext` | Interface | Runtime context provided to `action.run(input, ctx)` |
| `ActionDefinition` | Interface | Schema and execution contract for an Action |
| `ExecutionResult` | Type | Standard JSON envelope (`ok: true, data` or `ok: false, error`) |
| `RuntimeError` | Interface | Machine-readable runtime error contract |
| `RunRecord` | Interface | Execution run history record metadata |

---

## License

[Apache-2.0](LICENSE) © team4u
