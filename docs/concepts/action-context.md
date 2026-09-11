# 核心概念：ActionContext

`ActionContext` 是 Action 执行期间接收的运行时上下文对象，为 Action 提供标准化的环境访问能力。

```ts
import type { ActionContext } from "@actiondock/sdk";

export default defineAction(async (input, ctx: ActionContext) => {
  // 使用 ctx.config, ctx.state, ctx.actions, ctx.process, ctx.log, ctx.progress, ctx.signal, ctx.run
});
```

---

## 核心能力矩阵

```text
ActionContext
  │
  ├── ctx.config   → 6 级优先级配置读取（只读）
  ├── ctx.state    → SQLite 状态持久化与生存时间管理（读写）
  ├── ctx.actions  → Action 间安全级联调用与循环检测
  ├── ctx.process  → 统一受管外部进程操作接口（exec 与 spawn）
  ├── ctx.log      → 结构化日志记录器（强制输出至标准错误流）
  ├── ctx.progress → 阶段进度汇报接口
  ├── ctx.signal   → 标准 AbortSignal 取消传播链路
  └── ctx.run      → 当前任务运行元数据与调用链路追溯
```

---

## `ctx.config`：多级配置解析机制

ActionDock 实现了严格的 6 级配置回退优先级模型：

```text
单次调用参数覆盖 (--config KEY=VALUE)                    [最高]
       ↓
包级 SQLite 持久化配置数据库 (ad config set KEY VALUE)
       ↓
全局 SQLite 持久化配置数据库 (ad config set -g KEY VALUE)
       ↓
操作系统环境变量与环境文件映射 (PACKAGE__KEY / KEY)
       ↓
项目清单默认配置 (actiondock.json -> config.<KEY>.default)
       ↓
代码内联默认回退 (ctx.config.get("KEY", "fallback"))     [最低]
```

### 环境变量解析规则
- 显式映射：`actiondock.json` 中配置项声明的 `env` 字段映射。
- 包前缀转换：包标识符转为大写下划线前缀匹配环境变量。
- 全局匹配：直接读取同名大写环境变量。
- 类型自动转换：环境变量中的 `"true"` 与 `"false"` 转为布尔型，数字字符串转为数值型，JSON 字符串转为对象或数组。

---

## `ctx.state`：持久化状态与生存时间

Action 在执行过程中常需要持久化状态（如分页游标、增量同步位点、缓存或限流计数）。ActionDock 为每个包提供独立的 SQLite 状态存储空间：

```ts
// 写入状态（支持存活时间，单位：秒）
await ctx.state.set("last_sync_time", new Date().toISOString(), 3600);

// 读取状态（不存在或已过期返回 undefined）
const lastSync = await ctx.state.get<string>("last_sync_time");

// 命名空间隔离
const cacheState = ctx.state.scope("cache");
await cacheState.set("user_101", { name: "Alice" });
```

---

## `ctx.actions`：级联调用、跨包寻址与防循环机制

Action 之间可以通过 [`ActionInvoker`](../reference/action-api.md#actioninvoker) 互相安全调用。

### 调用规范与入参约束

`ctx.actions.invoke` 严格仅接受动作标识符字符串或 [`ActionRef`](../reference/action-api.md#actionref) 引用对象，**严禁传入动作定义对象或裸函数**。传入定义对象会绕过清单声明、模式校验与运行记录持久化，系统将抛出 `INVALID_ACTION_REF` 错误。

```ts
// 短标识符调用（本包或已声明依赖的动作）
const profile = await ctx.actions.invoke("get-user", {
  username: "octocat",
});

// 完全限定标识符调用（调用已声明依赖的外部包动作）
const stats = await ctx.actions.invoke("shared-pkg/get-stats", {
  username: "octocat",
});

// ActionRef 引用对象调用
const repo = await ctx.actions.invoke({
  packageId: "team4u.github-tools",
  actionId: "get-repo",
}, {
  repo: "team4u/actiondock",
});
```

### 依赖声明与可见性校验

- 所有级联调用必须在 `actiondock.json` 中显式声明：本包调用在 `actions.<id>.uses` 中声明依赖短 ID，跨包调用必须声明完全限定 ID。
- 未在 `uses` 中声明的级联调用，即使目标 Action 物理可见，执行时也会被拦截并返回 `UNDECLARED_ACTION_DEPENDENCY` 错误。

### 循环调用与配额防护

- 执行引擎在整个调用链路上自动追踪调用关系栈。当检测到 Action A 调用 Action B、Action B 又调用 Action A 的循环成环时，立即终止并返回 `ACTION_CALL_CYCLE` 错误。
- 宿主对单个根运行的调用深度和子运行总数设有限额，超出配额限制时返回 `ACTION_SUBRUN_LIMIT`。

---

## `ctx.process`：统一进程操作接口

针对外部命令调度，[`ProcessAPI`](../reference/action-api.md#processapi) 仅提供 `exec` 与 `spawn` 两个受管方法：

```ts
// 执行外部命令并获取结果
const result = await ctx.process.exec("git", ["status", "--porcelain"], {
  cwd: process.cwd(),
  timeoutMs: 5000,
  signal: ctx.signal,
});

if (!result.ok) {
  ctx.log.error(`Git 执行异常: ${result.stderr}`);
}
```

- 进程生命周期与根任务取消信号绑定，超时或取消时自动清理受管进程树。
- 标准输出与标准错误设置缓冲区字节上限，超限自动温和终止后强杀。

---

## `ctx.log`：标准错误流日志隔离

所有通过 `ctx.log` 打印的日志均输出至标准错误流：

```ts
ctx.log.debug("内部调试信息", { rawPayload });
ctx.log.info(`开始处理任务: ${taskId}`);
ctx.log.warn("接口请求频率接近阈值");
ctx.log.error("执行失败", err);
```

标准输出通道仅保留纯净的机器可解析 JSON 信封，杜绝日志混入数据流污染大模型或自动化脚本。

---

## `ctx.progress`：执行进度汇报

长耗时任务通过 `ctx.progress.report` 汇报阶段进度：

```ts
ctx.progress.report(50, 100, "数据转换完成，正在写入数据库");
```

进度事件会通过事件总线向订阅者推送。

---

## `ctx.signal`：协同式取消链路

`ctx.signal` 为标准 Web API 的 `AbortSignal` 实例：

```ts
const res = await fetch("https://api.example.com/long-task", {
  signal: ctx.signal,
});
```

当客户端通过协议发起取消、用户按下 Ctrl+C 或触发超时时，`ctx.signal` 立即触发中止事件，确保资源快速释放。

---

## `ctx.run`：任务追溯元数据

提供当前任务的运行标识、根任务标识与父级标识：

```ts
const { id, rootId, parentId } = ctx.run;
ctx.log.info(`当前执行标识: ${id}, 根任务标识: ${rootId}`);
```
