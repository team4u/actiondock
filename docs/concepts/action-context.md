# 核心概念：ActionContext

`ActionContext` 是 Action 执行期间接收的运行时上下文对象，为 Action 提供标准化的环境访问能力。

```ts
async run(input: TInput, ctx: ActionContext): Promise<TOutput> {
  // 使用 ctx.config, ctx.state, ctx.actions, ctx.log, ctx.signal
}
```

---

## 核心能力矩阵

```text
ActionContext
  │
  ├── ctx.config   → 5 级优先级配置读取 (只读)
  ├── ctx.state    → SQLite 状态持久化与 TTL 管理 (读写)
  ├── ctx.actions  → Action 间安全级联调用与循环检测
  ├── ctx.log      → 结构化日志记录器 (强制输出至 stderr)
  └── ctx.signal   → Web 标准 AbortSignal 取消传播链路
```

---

## `ctx.config`：5 级配置解析机制

ActionDock 实现了业界最严格的 5 级配置回退优先级模型：

```text
调用参数覆盖 (--config k=v)                          [最高]
       ↓
SQLite 持久化配置库 (ad config set KEY val)
       ↓
环境变量 (PACKAGE__KEY / KEY)
       ↓
项目默认配置 (actiondock.json -> defaultConfig)
       ↓
代码内联兜底 (ctx.config.get("KEY", "fallback"))     [最低]
```

### 环境变量解析规则
- **显式映射**：`actiondock.json` 中声明的 `env` 映射。
- **包前缀转换**：包标识符转大写下划线前缀（例如 `TEAM4U_GITHUB_TOOLS__API_TOKEN`）。
- **全局匹配**：直接读取 `API_TOKEN`。
- **类型强转**：环境变量中的 `"true"`/`"false"` 转为布尔型，数字字符串转为数值型。

---

## `ctx.state`：持久化状态与 TTL

Action 经常需要记录运行状态（例如上次同步的 offset、游标、缓存数据或限流计数器）。ActionDock 内置基于 SQLite 的轻量状态持久化机制。

```ts
// 写入状态（支持 TTL 过期时间，单位：秒）
await ctx.state.set("last_sync_time", new Date().toISOString(), 3600);

// 读取状态（不存在或已过期返回 undefined）
const lastSync = await ctx.state.get<string>("last_sync_time");

// 作用域隔离 (Namespace)
const cacheState = ctx.state.scope("cache");
await cacheState.set("user_101", { name: "Alice" });
```

---

## `ctx.actions`：级联调用、跨包寻址与防循环机制

Action 之间可以互相安全调用，支持直接对象引用、短标识符以及跨包动态寻址，同时保留完整的入参校验与日志链路：

```ts
import getUserAction from "./get-user";

// 方式一：直接通过定义对象调用（适用于同包已导入模块，具备静态类型推导）
const user = await ctx.actions.invoke(getUserAction, {
  username: "octocat",
});

// 方式二：通过短标识符调用（适用于同包或自包含导出的下游动作）
const profile = await ctx.actions.invoke("get-user", {
  username: "octocat",
});

// 方式三：通过完全限定标识符跨包调用（适用于 ad link 挂载的外部共享包动作）
const stats = await ctx.actions.invoke("shared-pkg/get-stats", {
  username: "octocat",
});

// 方式四：通过 ActionRef 引用对象调用
const repo = await ctx.actions.invoke({ packageId: "team4u.github-tools", actionId: "get-repo" }, {
  repo: "team4u/actiondock",
});
```

### 动态寻址与调用机制

- **短标识符与自包含模式**：
  - 在动作契约中声明 `uses: ["get-user"]`，代码中调用 `ctx.actions.invoke("get-user", input)`。
  - 构建导出时，[`BuildPlanner`](file:///root/code/action-dock/packages/builder/src/planner.ts) 自动将依赖闭包抽取并打包为自包含的独立技能资产。
  - 消费者挂载多个包含同名依赖的自包含包时，各包在内部封闭运行，互不干扰。
- **完全限定标识符与外部共享包模式**：
  - 在动作契约中声明 `uses: ["shared-pkg/get-stats"]`，代码中调用 `ctx.actions.invoke("shared-pkg/get-stats", input)`。
  - 运行时通过全局注册表动态查找已通过 `ad link` 挂载的目标包并执行。
  - 所有调用方共享目标包的单一实例与底层状态存储，避免代码拷贝并保障状态一致。

### 循环调用防御
当 Action A 调用 Action B，Action B 又调用 Action A 时，执行引擎会自动检测调用链中的重复 ID，并在达到阈值时立即抛出 `ACTION_CYCLE_DETECTED` 错误，防止死循环耗尽资源。

---

## `ctx.log`：强制 stderr 隔离日志

所有通过 `ctx.log` 打印的日志均被格式化并输出到 `stderr`：

```ts
ctx.log.debug("内部调试信息", { rawPayload });
ctx.log.info(`开始处理任务: ${taskId}`);
ctx.log.warn("API 频率接近限额");
ctx.log.error("处理失败", err);
```

终端输出效果：
```text
[12:00:00] [INFO] [github.get-pr] 开始处理任务: 101
```

由于 `stdout` 仅用于传输机器格式的 JSON Envelope，大模型与自动化流水线不会受到任何控制台日志的干扰。

---

## `ctx.signal`：协同式取消链路

`ctx.signal` 是标准的 Web API `AbortSignal` 实例：

```ts
// 将 signal 透传给 fetch 或子进程
const res = await fetch("https://api.example.com/long-task", {
  signal: ctx.signal,
});
```

当客户端通过 MCP 取消请求、用户在 CLI 按下 `Ctrl+C`、或触发了超时上限（`timeout`）时，`ctx.signal` 会被触发，确保底层网络连接与 I/O 资源立即释放。
