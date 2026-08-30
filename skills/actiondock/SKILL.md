---
name: actiondock
description: Comprehensive toolchain guide for creating, developing, testing, building, and exporting standalone AI Agent Actions and Skills with ActionDock 2.0 (Bun + TypeScript).
---

# ActionDock 2.0 Skill

ActionDock 2.0 is a Bun + TypeScript toolchain for building standalone AI Agent Actions. It compiles TypeScript actions into zero-install standalone executables alongside markdown `SKILL.md` documents.

---

## 1. Project Management

### Initialize a new project
```bash
actiondock init [directory] --id <package-id> --name <display-name> --desc <description>
```
Creates `actiondock.json`, `package.json`, `tsconfig.json`, `actions/`, `playbooks/`, and `tests/`.

### Inspect project
```bash
actiondock info [--json]
```

---

## 2. Action Authoring & Creation

### Scaffold a new action
```bash
actiondock action create <action-id> --desc "Action description" [--file <filename.ts>]
```

### Action Definition Pattern
Each action in `actions/<name>.ts` uses `defineAction` from `@actiondock/sdk`:

```ts
import { defineAction } from "@actiondock/sdk";

export interface Input {
  repo: string;
  maxCount?: number;
}

export interface Output {
  items: Array<{ id: string; title: string }>;
  total: number;
}

export default defineAction<Input, Output>({
  id: "github.list-issues",
  description: "List issues for a repository",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository in owner/repo format" },
      maxCount: { type: "number", default: 10 },
    },
    required: ["repo"],
  },

  outputSchema: {
    type: "object",
    properties: {
      items: { type: "array" },
      total: { type: "number" },
    },
    required: ["items", "total"],
  },

  async run(input, ctx) {
    // 1. Config: CLI override > SQLite DB > actiondock.json default
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");

    // 2. State: Persistent KV across runs
    const lastSync = await ctx.state.get<string>("last_sync");
    await ctx.state.set("last_sync", new Date().toISOString());

    // 3. Logger: Writes to stderr (does NOT pollute stdout JSON)
    ctx.log.info(`Fetching issues for ${input.repo}`);

    // 4. Action Composition: Call other actions (with cycle detection & parent run link)
    // const detail = await ctx.actions.invoke(otherAction, { ... });

    return {
      items: [],
      total: 0,
    };
  },
});
```

---

## 3. Development, Validation & Execution

### Validate action schemas
```bash
actiondock action validate [id] [--json]
```

### Show action details and schema
```bash
actiondock action show <id> [--json]
```

### Run an action (outputs standard JSON envelope on stdout)
```bash
actiondock action run <id> --input '{"repo": "owner/repo"}'
actiondock action run <id> --input-file ./input.json
actiondock action run <id> --config GITHUB_TOKEN=secret_token
```

Output format:
```json
{
  "ok": true,
  "runId": "uuid-...",
  "data": { ... }
}
```

---

## 4. Playbook SOPs

Playbooks (`playbooks/*.md`) provide SOP domain guidance for LLM Agents:

### Scaffold a playbook
```bash
actiondock playbook create <id> --desc "SOP Description" --actions action-a action-b
```

### Inspect playbooks
```bash
actiondock playbook list [--json]
actiondock playbook show <id> [--json]
actiondock playbook validate
```

---

## 5. Storage (Config & State)

### Config management
```bash
actiondock config list [--json]
actiondock config get <key> [--json]
actiondock config set <key> <value>
actiondock config delete <key>
```

### State inspection
```bash
actiondock state list [prefix] [--json]
actiondock state get <key> [--json]
actiondock state set <key> <json-value>
actiondock state delete <key>
```

### Run history
```bash
actiondock runs list [--action <id>] [--limit 20] [--json]
actiondock runs show <run-id> [--json]
```

---

## 6. Unit Testing Actions

Use `createTestRuntime` from `@actiondock/sdk`:

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import myAction from "../actions/my-action";

describe("my-action", () => {
  it("runs correctly with mock config and state", async () => {
    const runtime = createTestRuntime({
      config: { GITHUB_TOKEN: "mock-token" },
      state: { last_sync: "2026-01-01" },
    });

    const res = await runtime.run(myAction, { repo: "test/repo" });
    expect(res.total).toBe(0);
    expect(await runtime.state.get("last_sync")).toBeDefined();
  });
});
```

Run tests with:
```bash
actiondock test
# or
bun test
```

---

## 7. Build & Skill Export

### Build standalone executable
```bash
actiondock build [--target <target>] [--out <path>] [--minify]
```

### Export full Skill package
```bash
actiondock export skill [--target <target>] [--out <path>] [--archive]
```

Produces:
```text
dist/<package>-skill/
├── SKILL.md                  # LLM task instruction guide
├── actiondock.skill.json     # Machine-readable skill manifest
├── playbooks/                # Task SOP markdown files
└── bin/
    └── <package>             # Zero-install standalone executable
```
