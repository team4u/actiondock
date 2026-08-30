# Action Authoring Guide

This guide explains how to design, create, configure, test, and compose Actions in ActionDock 2.0.

---

## 1. Action Creation

You can create actions in two ways:

### Using the CLI Scaffold
```bash
actiondock action create github.list-prs --desc "List PRs from GitHub repository"
```
This generates a starter file in `actions/list-prs.ts`.

### Direct File Creation
Create any `.ts` file inside the `actions/` directory (or custom directory specified in `actiondock.json`).

---

## 2. Action Structure & Anatomy

```ts
import { defineAction } from "@actiondock/sdk";

// Types for TypeScript IntelliSense and type safety
export interface MyInput {
  paramA: string;
  paramB?: number;
}

export interface MyOutput {
  result: string;
  timestamp: string;
}

export default defineAction<MyInput, MyOutput>({
  id: "my-package.my-action",
  description: "Detailed description for agents and developers",

  // JSON Schema for input validation & discovery
  inputSchema: {
    type: "object",
    properties: {
      paramA: { type: "string", description: "Primary parameter" },
      paramB: { type: "number", description: "Optional number", default: 10 },
    },
    required: ["paramA"],
  },

  // JSON Schema for output validation
  outputSchema: {
    type: "object",
    properties: {
      result: { type: "string" },
      timestamp: { type: "string" },
    },
    required: ["result", "timestamp"],
  },

  async run(input, ctx) {
    // Action logic here
    return {
      result: `Processed ${input.paramA}`,
      timestamp: new Date().toISOString(),
    };
  },
});
```

---

## 3. The `ActionContext` API

The second parameter to `run(input, ctx)` provides 4 core domain capabilities:

### 1. `ctx.config`
Provides access to configuration values with three-tier precedence:
1. **Command Override**: Passed at runtime via `--config KEY=val`
2. **Local SQLite Database**: Configured via `actiondock config set KEY val`
3. **Project Defaults**: Declared under `"config"` in `actiondock.json`

```ts
const apiKey = ctx.config.get<string>("API_KEY");
const endpoint = ctx.config.get("API_ENDPOINT", "https://api.example.com");
```

### 2. `ctx.state`
Shared persistent Key-Value store backed by `bun:sqlite`. State is preserved across multiple action runs.

```ts
// Read state
const lastCursor = await ctx.state.get<string>("sync_cursor");

// Write state
await ctx.state.set("sync_cursor", nextCursor);

// Delete state
await ctx.state.delete("sync_cursor");

// Scoped state store (namespaces)
const orderState = ctx.state.scope("orders");
await orderState.set("order_123", { status: "shipped" });
```

### 3. `ctx.log`
Structured logging that writes directly to `stderr`, ensuring that `stdout` remains clean for JSON envelope outputs.

```ts
ctx.log.debug("Detailed diagnostic message");
ctx.log.info("Operation started", { id: input.id });
ctx.log.warn("Rate limit approaching");
ctx.log.error("Failed to fetch external resource", err);
```

### 4. `ctx.actions`
Enables calling other Actions via direct TypeScript imports. ActionDock automatically:
- Propagates context, config, and state
- Links parent and child Run records in the SQLite database
- Detects circular invocations (`ACTION_CYCLE_DETECTED`)

```ts
import fetchUserAction from "./fetch-user";

// Inside another action:
const user = await ctx.actions.invoke(fetchUserAction, { userId: "user-123" });
```

---

## 4. Testing Actions with `createTestRuntime`

You don't need databases or external mocks to test your actions:

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import myAction from "../actions/my-action";

describe("myAction unit test", () => {
  it("executes correctly with in-memory test runtime", async () => {
    const runtime = createTestRuntime({
      config: { API_KEY: "test-token" },
      state: { sync_cursor: "100" },
    });

    const output = await runtime.run(myAction, { paramA: "value" });
    expect(output.result).toContain("value");
    expect(runtime.logger.logs.length).toBeGreaterThan(0);
  });
});
```
