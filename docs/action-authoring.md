# Action 编写与开发指南

本指南详细介绍如何在 ActionDock 2.0 中设计、编写、配置、测试与组合 AI Agent Action。

---

## 1. 创建 Action

您可以通过以下两种方式创建 Action：

### 方式 1：使用 CLI 命令快速生成骨架（推荐）
```bash
actiondock action create github.list-prs --desc "获取 GitHub 仓库的 Pull Requests"
```
该命令会自动在 `actions/` 目录下创建带有类型与 Schema 声明的 `list-prs.ts` 模板。

### 方式 2：在 `actions/` 目录直接新建 TypeScript 文件
在项目的 `actions/` 目录下新建任意 `.ts` 文件，使用 `@actiondock/sdk` 的 `defineAction` 声明并默认导出。

---

## 2. Action 的基本结构与规范

```ts
import { defineAction } from "@actiondock/sdk";

// 1. 定义入参与出参的 TypeScript 接口（用于 IDE 代码补全与静态检查）
export interface MyInput {
  paramA: string;
  paramB?: number;
}

export interface MyOutput {
  result: string;
  timestamp: string;
}

// 2. 使用 defineAction 声明 Action 定义
export default defineAction<MyInput, MyOutput>({
  id: "my-package.my-action",                      // 全局唯一标识符
  description: "面向 AI Agent 和开发者的 Action 描述", // 工具能力说明

  // 3. 入参标准 JSON Schema（用于参数校验与 Agent 工具发现）
  inputSchema: {
    type: "object",
    properties: {
      paramA: { type: "string", description: "必填的主要参数" },
      paramB: { type: "number", description: "可选的数值参数", default: 10 },
    },
    required: ["paramA"],
  },

  // 4. 出参标准 JSON Schema（用于出参结构校验）
  outputSchema: {
    type: "object",
    properties: {
      result: { type: "string" },
      timestamp: { type: "string" },
    },
    required: ["result", "timestamp"],
  },

  // 5. 核心执行逻辑
  async run(input, ctx) {
    // 在此处编写业务逻辑
    return {
      result: `成功处理参数: ${input.paramA}`,
      timestamp: new Date().toISOString(),
    };
  },
});
```

---

## 3. `ActionContext` API 核心能力

`run(input, ctx)` 的第二个参数 `ctx` 提供了 ActionDock 特有的 4 大核心领域能力：

### ① `ctx.config`（配置访问）
支持三级优先级的配置解析：
1. **命令行临时覆盖**：运行命令时通过 `--config KEY=val` 传入。
2. **本地持久化存储**：通过 `actiondock config set KEY val` 写入本地 SQLite。
3. **项目声明默认值**：在 `actiondock.json` 的 `"config"` 中声明的 `default`。

```ts
const apiKey = ctx.config.get<string>("API_KEY");
const endpoint = ctx.config.get("API_ENDPOINT", "https://api.example.com");
```

### ② `ctx.state`（共享持久化状态）
基于内置 `bun:sqlite` 的持久化 Key-Value 存储，数据在 Action 多次调用之间跨进程保留，常用于断点续传（checkpoint）、增量同步游标（cursor）、去重与小型缓存：

```ts
// 读取状态
const lastCursor = await ctx.state.get<string>("sync_cursor");

// 写入状态
await ctx.state.set("sync_cursor", nextCursor);

// 删除状态
await ctx.state.delete("sync_cursor");

// 命名空间隔离 (Namespaces)
const orderState = ctx.state.scope("orders");
await orderState.set("order_123", { status: "shipped" });
```

### ③ `ctx.log`（结构化日志）
所有日志**强制输出至 `stderr`**，保证 `stdout` 仅包含机器可消费的标准 JSON Envelope，不会被杂乱的打印日志污染：

```ts
ctx.log.debug("调试诊断日志");
ctx.log.info("任务已启动", { id: input.id });
ctx.log.warn("API 调用速率接近限制");
ctx.log.error("调用外部接口失败", err);
```

### ④ `ctx.actions`（Action 间组合调用）
Action 可以直接通过普通 TypeScript `import` 引用其他 Action 并组合调用。ActionDock 会自动：
- 传递当前上下文环境、配置与状态。
- 在 SQLite 中自动建立父子 Run 级联记录。
- **自动进行循环依赖检测（`ACTION_CYCLE_DETECTED`）**，防止递归死循环。

```ts
import fetchUserAction from "./fetch-user";

// 在另一个 Action 内部组合调用:
const user = await ctx.actions.invoke(fetchUserAction, { userId: "user-123" });
```

---

## 4. 使用 `createTestRuntime` 进行单元测试

Action 开发者无需启动数据库或配置外部 Mock 工具，直接使用 `@actiondock/sdk` 提供的轻量内存测试运行时即可快速测试业务逻辑：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import myAction from "../actions/my-action";

describe("myAction 单元测试", () => {
  it("在内存测试运行时中正确执行", async () => {
    // 构造测试环境与初始数据
    const runtime = createTestRuntime({
      config: { API_KEY: "test-token" },
      state: { sync_cursor: "100" },
    });

    const output = await runtime.run(myAction, { paramA: "测试数据" });
    expect(output.result).toContain("测试数据");
    expect(runtime.logger.logs.length).toBeGreaterThan(0);
  });
});
```
