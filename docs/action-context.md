# ActionContext 核心能力详解

在 ActionDock 2.0 中，每个 Action 的 `run(input, ctx)` 执行函数都会接收一个强类型的上下文对象 `ctx`（即 `ActionContext`）。

本文档深入解析 `ActionContext` 提供的 5 大核心领域能力：**`ctx.config`**、**`ctx.state`**、**`ctx.actions`**、**`ctx.log`** 与 **`ctx.signal`**。


---

## 配置访问 (`ctx.config`)

`ctx.config` 提供了读取运行时配置的能力，专为环境密钥（如 API Token、网关地址、超时阈值等）设计。

### 配置解析优先级（5 层回退策略）

当调用 `ctx.config.get(key, defaultValue)` 时，ActionDock 按以下顺序解析配置：

```text
1. [命令行临时覆盖 (--config KEY=val / overrides)]
                 | (未提供则回退)
                 v
2. [项目本地 SQLite 存储 (.actiondock/storage.db)]
                 | (未设置则回退)
                 v
3. [全局 SQLite 存储 (~/.actiondock/global.db)]
                 | (未设置则回退)
                 v
4. [系统环境变量 (process.env / .env)]
                 | (未设置则回退)
                 v
5. [actiondock.json 声明的默认值 ("config[key].default")]
                 | (未声明则回退)
                 v
6. [代码内提供的 defaultValue 或 undefined]
```

### 环境变量探测与自动类型转换

ActionDock 内建了智能环境变量解析引擎：

1. **显式 Env 绑定**：若在 `actiondock.json` 中声明了 `env`（如 `"env": "GITHUB_PERSONAL_ACCESS_TOKEN"` 或 `"env": ["GH_TOKEN", "GITHUB_TOKEN"]`），优先检查对应环境变量。
2. **Package 命名空间前缀**：自动检查 `ACTIONDOCK_<PACKAGE>_<KEY>`（例如 `ACTIONDOCK_TEAM_GITHUB_TOOLS_TOKEN`），防止多包环境变量命名冲突。
3. **SNAKE_CASE 自动匹配**：驼峰命名与短横线键名自动转换为蛇形大写（例如 `apiKey` 或 `api-key` -> `API_KEY`）。
4. **原始键名匹配**：直接探测同名键名。
5. **智能类型转换（Type Coercion）**：
   - `boolean`: `"true"`, `"1"`, `"yes"`, `"on"` -> `true`；`"false"`, `"0"`, `"no"`, `"off"` -> `false`
   - `number`: `"5000"` -> `5000`
   - `object` / `array`: JSON 字符串自动解析为对应 JS 对象/数组

### `actiondock.json` 配置清单声明示例

```json
{
  "id": "team.github-tools",
  "config": {
    "apiToken": {
      "description": "GitHub 个人访问令牌",
      "type": "string",
      "env": ["GITHUB_TOKEN", "GH_TOKEN"],
      "secret": true
    },
    "timeoutMs": {
      "description": "请求超时毫秒数",
      "type": "number",
      "default": 5000,
      "env": "GITHUB_TIMEOUT_MS"
    },
    "enableDebug": {
      "description": "是否开启调试日志",
      "type": "boolean",
      "default": false
    }
  }
}
```

### API 规范与示例

```ts
// 获取配置字符串（支持泛型推导）
const apiKey = ctx.config.get<string>("apiToken");

// 提供代码级兜底默认值
const apiBase = ctx.config.get("apiBaseUrl", "https://api.github.com");

// 读取布尔值或数值（环境变量注入时自动转换类型）
const timeoutMs = ctx.config.get<number>("timeoutMs", 5000);
const debugMode = ctx.config.get<boolean>("enableDebug", false);
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

// 设置带有 TTL（过期时间，单位：秒）的状态
await ctx.state.set("auth_token", "jwt_token_12345", 3600); // 1 小时后过期
await ctx.state.set("temp_cache", { temp: true }, 60); // 60 秒后过期

// 删除指定状态
await ctx.state.delete("checkpoint_data");

// 列出前缀匹配的键名（自动过滤并清理已过期的键）
const allOrderKeys = await ctx.state.keys("order_");

// 命名空间隔离 (Scoped State Store)
const orderStore = ctx.state.scope("orders");
await orderStore.set("ord_1001", { amount: 99.5, status: "PAID" }, 86400);
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

---

## 取消信号与生命周期 (`ctx.signal`)

`ctx.signal` 是一个标准的 Web API `AbortSignal` 对象，为 Action 提供了感知外部中断、超时和客户端取消的能力。

### 适用场景
* **网络请求与长耗时 I/O**：将 `ctx.signal` 直接透传给 `fetch`、数据库驱动或 Child Process。
* **分步批处理计算**：在循环或步骤之间检查 `ctx.signal.aborted` 或调用 `ctx.signal.throwIfAborted()`，及时停止无效计算。
* **MCP 客户端取消传播**：当 MCP Host 发送 `notifications/cancelled` 时，信号会直达 Action 内部。
* **CLI 超时与 Ctrl+C**：CLI 传入 `--timeout 30s` 或用户在终端按下 `Ctrl+C` 时，信号会自动触发 abort。

### API 规范与示例

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "http.download-report",
  description: "下载大型分析报告",

  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
  },

  async run(input, ctx) {
    ctx.log.info(`开始下载: ${input.url}`);

    // 1. 将 signal 传给原生 fetch（一旦触发取消，底层 TCP 连接将立即断开）
    const response = await fetch(input.url, {
      signal: ctx.signal,
    });

    const data = await response.json();

    // 2. 长耗时批处理前检查取消状态
    ctx.signal.throwIfAborted();

    // 3. 事件监听式取消响应
    ctx.signal.addEventListener("abort", () => {
      ctx.log.warn("收到中断信号，正在清理临时资源...");
    });

    return {
      status: "completed",
      size: JSON.stringify(data).length,
    };
  },
});
```
