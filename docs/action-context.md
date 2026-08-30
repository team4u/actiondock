# ActionContext 核心能力详解

在 ActionDock 2.0 中，每个 Action 的 `run(input, ctx)` 执行函数都会接收一个强类型的上下文对象 `ctx`（即 `ActionContext`）。

本文档深入解析 `ActionContext` 提供的 4 大核心领域能力：**`ctx.config`**、**`ctx.state`**、**`ctx.actions`** 与 **`ctx.log`**。

---

## 配置访问 (`ctx.config`)

`ctx.config` 提供了读取运行时配置的能力，专为环境密钥（如 API Token、网关地址、超时阈值等）设计。

### 配置解析优先级（三级策略）

当调用 `ctx.config.get(key, defaultValue)` 时，ActionDock 按以下顺序解析配置：

```text
[命令行临时覆盖 (--config KEY=val)]
                 | (未提供则回退)
                 v
[本地持久化数据库存储 (ac config set KEY val)]
                 | (未设置则回退)
                 v
[actiondock.json 声明的默认值 ("config[key].default")]
                 | (未声明则回退)
                 v
[代码内提供的 defaultValue 或 undefined]
```

### API 规范与示例

```ts
// 获取配置字符串
const apiKey = ctx.config.get<string>("GITHUB_TOKEN");

// 提供回退默认值
const apiBase = ctx.config.get("API_BASE_URL", "https://api.github.com");

// 读取布尔值或数值
const timeoutMs = ctx.config.get<number>("TIMEOUT_MS", 5000);
const debugMode = ctx.config.get<boolean>("DEBUG_MODE", false);
```

---

## 持久化共享状态 (`ctx.state`)

`ctx.state` 是一个基于 `bun:sqlite` 的 Key-Value 持久化存储，数据在 Action 多次调用之间跨进程保留。

### 适用场景
* **断点续传与 Checkpoint**：记录长耗时批量任务的处理进度。
* **游标与分页（Cursor）**：增量同步日志或拉取事件流时的最新时间戳或 ID。
* **统计与计数**：累计调用次数、限流窗口统计。
* **临时结果缓存**：缓存计算成本较高的中间数据。

### API 规范与示例

```ts
// 异步读取状态
const lastCursor = await ctx.state.get<string>("last_synced_id");

// 异步写入状态（支持任意可 JSON 序列化的数据类型）
await ctx.state.set("last_synced_id", "evt_987654");
await ctx.state.set("checkpoint_data", {
  processedCount: 150,
  isFinished: false,
  updatedAt: new Date().toISOString(),
});

// 删除指定状态
await ctx.state.delete("checkpoint_data");

// 列出前缀匹配的键名
const allOrderKeys = await ctx.state.keys("order_");

// 命名空间隔离 (Scoped State Store)
const orderStore = ctx.state.scope("orders");
await orderStore.set("ord_1001", { amount: 99.5, status: "PAID" });
const order = await orderStore.get("ord_1001");
```

---

## Action 间组合调用 (`ctx.actions`)

ActionDock 原生支持将多个原子 Action 组合为高级复合 Action（Composite Action）。

通过普通的 TypeScript `import` 语句导入其他 Action 定义，并通过 `ctx.actions.invoke(action, input)` 执行调用。

### 核心机制与安全保障
* **环境与存储上下文透传**：被调用的子 Action 自动共享当前的 Config、State 与 Storage 上下文。
* **执行链路追踪（Runs Cascade）**：在 SQLite 的 `runs` 记录表中，子 Action 的 Run 记录会自动通过 `parent_run_id` 关联至父 Action，便于链路回溯。
* **循环调用依赖防御（Cycle Detection）**：ActionDock 会在内存调用栈中追踪执行链。一旦检测到 `Action A -> Action B -> Action A` 形式的递归或循环依赖，立即中止并抛出 `RuntimeError("ACTION_CYCLE_DETECTED")`。

### 代码示例

```ts
import { defineAction } from "@actiondock/sdk";
import getPrAction from "./get-pr";
import commentPrAction from "./comment-pr";

export default defineAction({
  id: "github.review-and-comment",
  description: "获取 PR 详情，执行评审并发帖",

  inputSchema: {
    type: "object",
    properties: {
      prNumber: { type: "number" },
    },
    required: ["prNumber"],
  },

  async run(input, ctx) {
    // 组合调用 getPrAction
    ctx.log.info(`第一步：获取 PR #${input.prNumber} 详情`);
    const pr = await ctx.actions.invoke(getPrAction, {
      prNumber: input.prNumber,
    });

    // 本地评审逻辑
    const reviewComment = pr.additions > 500
      ? "警告：本次 PR 变更行数较大，建议拆分。"
      : "评审通过：代码规模适中。";

    // 组合调用 commentPrAction
    ctx.log.info("第二步：发表评审意见");
    const commentRes = await ctx.actions.invoke(commentPrAction, {
      prNumber: input.prNumber,
      comment: reviewComment,
    });

    return {
      success: true,
      commentId: commentRes.commentId,
      verdict: reviewComment,
    };
  },
});
```

---

## 结构化日志输出 (`ctx.log`)

`ctx.log` 提供了标准的日志输出接口。

### 为什么强制输出到 stderr？
AI Agent 和自动化程序依赖 `stdout` 解析 Action 执行输出的标准 JSON Envelope。如果控制台打印（如 `console.log`）混杂在 `stdout` 中，会导致 JSON 解析器崩溃。

`ctx.log` 会自动将所有日志格式化为 `[HH:MM:SS] [LEVEL] [action-id] 消息内容` 并**强制写入 `stderr`**，彻底做到日志与数据流隔离。

### API 规范与示例

```ts
// 诊断信息 (DEBUG)
ctx.log.debug("内部变量详情", { rawPayload: data });

// 常规信息 (INFO)
ctx.log.info(`成功连接远程服务: ${url}`);

// 警告信息 (WARN)
ctx.log.warn("接口响应时间超过 3000ms，请注意延迟");

// 错误信息 (ERROR)
try {
  // ...
} catch (err: any) {
  ctx.log.error("处理数据异常", err);
}
```
