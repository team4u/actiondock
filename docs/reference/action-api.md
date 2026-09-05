# 参考手册：Action SDK API

`@actiondock/sdk` 是编写 ActionDock Action 的基础核心包，提供 Action 定义方法、数据契约接口与运行时上下文环境。

---

## `defineAction` 动作定义方法

用于声明一个标准 Action 动作定义：

```ts
import { defineAction, type ActionDefinition } from "@actiondock/sdk";

export function defineAction<TInput = unknown, TOutput = unknown>(
  definition: ActionDefinition<TInput, TOutput>
): ActionDefinition<TInput, TOutput>;
```

### `ActionDefinition` 接口规范

```ts
export interface ActionDefinition<I = unknown, O = unknown> {
  /** 全局唯一 Action 标识符，推荐使用命名空间前缀（如 sample.greet 或 github.get-pr） */
  id: string;
  /** 面向人类与智能体的功能描述说明 */
  description?: string;
  /** 输入参数模式规范（标准 JSON Schema） */
  inputSchema?: Record<string, unknown> | boolean;
  /** 输出结果模式规范（标准 JSON Schema） */
  outputSchema?: Record<string, unknown> | boolean;
  /** 静态调用的下游 Action 依赖标识列表，用于构建闭包裁剪与拓扑分析 */
  uses?: string[];
  /** 检索与分类标签列表 */
  tags?: string[];
  /** 扩展注解与元数据 */
  annotations?: Record<string, unknown>;
  /**
   * Action 核心业务逻辑执行函数
   * @param input 符合 inputSchema 约束的入参数据
   * @param ctx 运行时上下文对象
   */
  run(input: I, ctx: ActionContext): Promise<O> | O;
}
```

---

## `ActionContext` 运行时上下文

每次执行 Action 时，底层运行时引擎均会向 `run` 方法传入一个全新的 `ActionContext` 实例。该上下文包含 8 个核心子接口与数据对象：

```ts
export interface ActionContext {
  /** 配置读取接口，遵循多级回退策略 */
  config: Config;
  /** 状态持久化存储接口，具备命名空间与失效支持 */
  state: StateStore;
  /** Action 相互调用接口，内置调用栈深度与环路死锁保护 */
  actions: ActionInvoker;
  /** 统一异步进程操作接口，提供命令调度与守护进程拉起能力 */
  process: ProcessAPI;
  /** 结构化日志接口，输出至标准错误流以实现通道隔离 */
  log: Logger;
  /** 执行进度报告接口 */
  progress: ProgressReporter;
  /** 协作式取消信号，透传 AbortSignal */
  signal: AbortSignal;
  /** 当前执行链路的唯一标识与元数据 */
  run: {
    /** 本次 Action 执行的唯一标识 */
    id: string;
    /** 根任务执行标识，跨嵌套调用链路保持一致 */
    rootId: string;
    /** 直接父级 Action 执行标识（若存在） */
    parentId?: string;
  };
}
```

---

## 核心子接口详解

### 配置读取接口 `Config`

支持多级回退机制（命令行临时覆写 > SQLite 持久存储 > 操作系统环境变量 > 项目默认声明配置）：

```ts
export interface Config {
  /**
   * 读取指定键的配置值，若未配置则返回 undefined
   * @param key 配置键名
   */
  get<T = unknown>(key: string): T | undefined;

  /**
   * 读取指定键的配置值，若未配置则返回指定的默认值
   * @param key 配置键名
   * @param defaultValue 回退默认值
   */
  get<T = unknown>(key: string, defaultValue: T): T;

  /**
   * 检查指定键名是否存在有效配置
   * @param key 配置键名
   */
  has(key: string): boolean;
}
```

### 状态持久化存储接口 `StateStore`

基于内嵌存储引擎，支持生存时间自动失效与命名空间隔离：

```ts
export interface StateStore {
  /**
   * 读取指定键的状态值；若该键已超时失效则返回 undefined
   * @param key 状态键名
   */
  get<T = unknown>(key: string): Promise<T | undefined>;

  /**
   * 写入状态键值对，可选指定生存时间
   * @param key 状态键名
   * @param value 需存储的数据对象
   * @param ttl 存活秒数；不传或小于等于 0 表示永久有效
   */
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * 删除指定键的状态数据
   * @param key 状态键名
   */
  delete(key: string): Promise<boolean>;

  /**
   * 清空当前命名空间下的状态数据，支持按前缀过滤
   * @param prefix 可选的键名前缀过滤项
   */
  clear(prefix?: string): Promise<number>;

  /**
   * 列出当前命名空间下所有匹配前缀的键名列表
   * @param prefix 可选的键名前缀过滤项
   */
  keys(prefix?: string): Promise<string[]>;

  /**
   * 派生具有独立命名空间隔离的子 StateStore 实例
   * @param namespace 命名空间名称
   */
  scope(namespace: string): StateStore;
}
```

### Action 互调接口 `ActionInvoker`

支持 Action 之间的相互调用，运行时自动维护调用栈深度，一旦检测到循环调用（例如 A 调用 B，B 又调用 A）将立即抛出带有明确调用链的错误，杜绝死锁与栈溢出：

```ts
export interface ActionInvoker {
  /**
   * 调用指定的下游 Action 并传入参数，返回其执行结果
   * @param action 目标 Action 定义对象、引用或标识符
   * @param input 传递给目标 Action 的输入参数
   */
  invoke<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | ActionRef | string,
    input?: I
  ): Promise<O>;
}
```

### 结构化日志接口 `Logger`

日志专供开发者排查与观察，物理上定向输出至标准错误流（`stderr`），杜绝混入标准输出（`stdout`）的结构化 JSON 数据流：

```ts
export interface Logger {
  /** 记录调试级别日志 */
  debug(message: string, data?: unknown): void;
  /** 记录信息级别日志 */
  info(message: string, data?: unknown): void;
  /** 记录警告级别日志 */
  warn(message: string, data?: unknown): void;
  /** 记录错误级别日志 */
  error(message: string, data?: unknown): void;
}
```

### 任务进度报告接口 `ProgressReporter`

在长耗时任务中向消费端与事件总线汇报阶段进度：

```ts
export interface ProgressReporter {
  /**
   * 报告当前任务执行进度
   * @param current 当前已完成的工作量数值
   * @param total 任务预期总量数值（可选）
   * @param message 当前步骤阶段的文字说明（可选）
   */
  report(current: number, total?: number, message?: string): void;
}
```

---

## 统一异步进程操作接口 `process`

ActionDock 2.0 在 `ctx.process` 上提供了统一的异步进程操作接口 `ProcessAPI`，针对外部命令调用中常见的管道死锁、僵尸进程以及 Windows 兼容性问题提供了工业级防护。

```ts
export interface ProcessAPI {
  /** 异步执行外部命令并返回标准化执行结果 */
  exec(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>;

  /** 异步拉起脱离父进程的后台常驻守护进程并轮询就绪探针 */
  spawnDetached(options: DetachedProcessOptions): Promise<DetachedProcessResult>;
}
```

### 异步外部命令执行 `process.exec`

`process.exec` 用于安全调用操作系统外部命令行工具（如 `git`、`docker`、`curl`、`jq` 等）。

#### 选项参数 `ProcessExecOptions`
```ts
export interface ProcessExecOptions {
  /** 子进程执行的工作目录（默认当前工作目录） */
  cwd?: string;
  /** 注入子进程的环境变量映射 */
  env?: Record<string, string>;
  /** 写入子进程标准输入的文本或字节流（用于管道输送） */
  input?: string | Uint8Array;
  /** 单次执行超时毫秒数；超时将自动强杀进程并置位 timedOut */
  timeoutMs?: number;
  /** 协作式取消信号（可传入 ctx.signal） */
  signal?: AbortSignal;
  /** 输出字符解码编码（默认 utf-8，支持 gbk/cp936） */
  encoding?: string;
  /** 退出码非 0 时是否直接抛出异常（默认 false，返回包含错误信息的结果结构） */
  throwOnError?: boolean;
  /** 允许缓冲的最大输出字节数，防止极端情况内存耗尽 */
  maxOutputBytes?: number;
}
```

#### 返回结果 `ProcessResult`
```ts
export interface ProcessResult {
  /** 命令是否成功结束（退出码为 0 且未超时或取消） */
  ok: boolean;
  /** 进程退出状态码（异常中断时为 null） */
  exitCode: number | null;
  /** 导致进程退出的信号名称（如 SIGTERM） */
  signal?: string;
  /** 标准输出文本 */
  stdout: string;
  /** 标准错误文本 */
  stderr: string;
  /** 原始字节数组输出（适用于二进制产物处理） */
  raw: Uint8Array;
  /** 是否因超出 timeoutMs 超时被强杀 */
  timedOut: boolean;
  /** 是否因 AbortSignal 触发被取消 */
  cancelled: boolean;
  /** 命令执行耗时（毫秒） */
  durationMs: number;
  /** 结构化运行时错误详情（若失败） */
  error?: RuntimeError;
}
```

#### 使用示例
```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "git.commit-info",
  async run(_input, ctx) {
    const res = await ctx.process.exec("git", ["log", "-1", "--format=%H %s"], {
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: ctx.signal,
    });

    if (res.timedOut) {
      throw new Error("Git 命令执行超时");
    }

    if (!res.ok) {
      throw new Error(`Git 执行失败: ${res.stderr}`);
    }

    ctx.log.info(`Git 提交信息检索完成，耗时: ${res.durationMs}ms`);
    return { commit: res.stdout.trim() };
  },
});
```

### 守护进程拉起与就绪探测 `process.spawnDetached`

当需要拉起常驻后台的外部守护服务（如无头浏览器后台服务、临时缓存代理服务等）时，传统子进程调用会因继承标准流句柄而永远无法关闭管道，造成调用方挂起超时。`process.spawnDetached` 采用脱离父进程启动并断开标准流连接，配合异步轮询就绪探针完成安全闭环。

#### 选项参数 `DetachedProcessOptions`
```ts
export interface DetachedProcessOptions {
  /** 启动命令或可执行文件路径 */
  command: string;
  /** 传递给命令的命令行参数数组 */
  args?: string[];
  /** 子进程工作目录 */
  cwd?: string;
  /** 注入的环境变量 */
  env?: Record<string, string>;
  /** 启动并探测的总超时毫秒数（默认 30000 毫秒） */
  timeoutMs?: number;
  /** 协作式取消信号 */
  signal?: AbortSignal;
  /** 轮询就绪探针的时间间隔毫秒数（默认 400 毫秒） */
  probeIntervalMs?: number;
  /** 单次探针探测的超时毫秒数 */
  probeTimeoutMs?: number;
  /**
   * 就绪判定探针回调函数
   * 周期性执行，当返回 true 或解析为 true 时判定服务成功就绪
   */
  probe?: (result: ProcessResult) => boolean | Promise<boolean>;
}
```

#### 返回结果 `DetachedProcessResult`
```ts
export interface DetachedProcessResult {
  /** 守护进程是否启动并探测就绪成功 */
  ok: boolean;
  /** 成功拉起的后台操作系统进程标识号 PID */
  pid?: number;
  /** 就绪探针是否最终判定为就绪状态 */
  ready: boolean;
  /** 启动与等待就绪总耗时（毫秒） */
  durationMs: number;
  /** 错误详情（若启动失败或探测超时） */
  error?: RuntimeError;
}
```

#### 使用示例
```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "browser.launch-daemon",
  async run(_input, ctx) {
    // 异步拉起常驻守护进程并探针等待就绪
    const res = await ctx.process.spawnDetached({
      command: "agent-browser",
      args: ["daemon", "--port", "9222"],
      timeoutMs: 15000,
      probeIntervalMs: 500,
      signal: ctx.signal,
      probe: async () => {
        // 轻量探测后台端口或健康状态接口
        const probeRes = await ctx.process.exec("curl", ["-s", "http://127.0.0.1:9222/json/version"], {
          timeoutMs: 1000,
        });
        return probeRes.ok && probeRes.stdout.includes("Browser");
      },
    });

    if (!res.ok || !res.ready) {
      throw new Error(`浏览器后台守护进程启动失败或就绪超时: ${res.error?.message}`);
    }

    ctx.log.info(`守护进程已就绪，进程标识: ${res.pid}`);
    return { pid: res.pid, ready: true };
  },
});
```
