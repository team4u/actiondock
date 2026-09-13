# 参考手册：Action SDK API

[`@actiondock/sdk`](../../packages/sdk/README.md) 是编写 ActionDock Action 的基础核心包，提供 Action 定义方法、契约接口与运行时上下文环境。

---

## `defineAction` 动作定义方法

用于声明 Action 业务执行处理函数：

```ts
import { defineAction, type ActionDefinition, type ActionHandler } from "@actiondock/sdk";

// 直接传入处理函数
export default defineAction<TInput, TOutput>(async (input, ctx) => {
  return { ... };
});

// 传入包含 run 方法的定义对象
export default defineAction<TInput, TOutput>({
  async run(input, ctx) {
    return { ... };
  },
});
```

### ActionDefinition 契约规范

在 ActionDock 2.0 中，`actiondock.json` 是元数据的权威事实源。`ActionDefinition` 仍保留代码内元数据字段用于兼容和编程式调用场景，新项目推荐将元数据统一声明在清单中：

```ts
export interface ActionDefinition<I = unknown, O = unknown> {
  /**
   * Action 核心业务逻辑执行函数
   * @param input 符合输入模式约束的入参数据
   * @param ctx 运行时上下文对象
   */
  run(input: I, ctx: ActionContext): Promise<O> | O;
  /** Action 唯一标识 */
  id?: string;
  /** Action 功能描述 */
  description?: string;
  /** 输入参数模式规范 */
  inputSchema?: JsonSchema;
  /** 输出结果模式规范 */
  outputSchema?: JsonSchema;
  /** 静态 Action 依赖列表 */
  uses?: string[];
  /** 检索与分类标签 */
  tags?: string[];
  /** 协议注解元数据 */
  annotations?: Record<string, JsonValue>;
}
```

---

## `ActionContext` 运行时上下文

每次执行 Action 时，底层运行时引擎均向 `run` 方法传入全新的 `ActionContext` 实例：

```ts
export interface ActionContext {
  /** 配置读取接口，遵循多级回退策略 */
  config: Config;
  /** 状态持久化存储接口，具备命名空间与存活时间支持 */
  state: StateStore;
  /** Action 相互调用接口，内置调用栈深度与环路保护 */
  actions: ActionInvoker;
  /** 统一受管外部进程操作接口 */
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

支持多级回退机制（单次调用覆盖 > 包级持久存储 > 环境变量 `process.env` > 清单默认声明 > 内联默认值）：

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

---

### 状态持久化存储接口 `StateStore`

基于包级独立的 SQLite 存储引擎，支持存活时间自动失效与命名空间隔离：

```ts
export interface StateStore {
  /**
   * 读取指定键的状态值；若该键已超时失效则返回 undefined
   * @param key 状态键名
   */
  get<T = unknown>(key: string): Promise<T | undefined>;

  /**
   * 写入状态键值对，可选指定存活时间
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

---

### Action 互调接口 `ActionInvoker`

支持 Action 之间的安全调用，运行时自动校验依赖声明并维护调用栈深度与环路保护：

```ts
export interface ActionInvoker {
  /**
   * 直接调用指定的 Action
   * @param ref 目标 Action 引用或标识符
   * @param input 传递给目标 Action 的输入参数
   */
  (ref: string | ActionRef, input?: unknown): Promise<unknown>;

  /**
   * 调用指定的 Action 并传入参数，返回其执行结果
   * @param action 目标 Action 引用或标识符
   * @param input 传递给目标 Action 的输入参数
   */
  invoke<I = unknown, O = unknown>(
    action: ActionRef | string,
    input?: I
  ): Promise<O>;
}

export interface ActionRef {
  /** 所属包标识（可选） */
  packageId?: string;
  /** Action 动作标识 */
  actionId: string;
}
```

#### 调用参数约束与禁止事项
- 仅接受标识符与引用：`ctx.actions.invoke` 严格只接受动作标识符字符串（短标识符如 `"greet"` 或跨包限定标识符如 `"shared-pkg/b"`）或 `ActionRef` 引用对象。
- 禁止传入动作定义对象：**严禁将 ActionDefinition 对象或裸函数传入 ctx.actions.invoke**。传入定义对象将绕过 `actiondock.json` 清单校验、模式规范检查与子运行链路记录，执行引擎将抛出 `INVALID_ACTION_REF` 错误。
- 依赖必须显式声明：所有通过 `ctx.actions.invoke` 发起的级联调用，必须在当前包 `actiondock.json` 的 `uses` 列表中显式声明。未声明的调用将返回 `UNDECLARED_ACTION_DEPENDENCY` 错误。
- 循环调用防护：当检测到相互调用成环时，执行引擎抛出 `ACTION_CALL_CYCLE` 错误。

---

### 统一受管进程接口 ProcessAPI

ActionDock 2.0 提供工业级受管进程接口 ProcessAPI，统一管理短时有界外部命令与长期交互式进程，覆盖进程启动、独占控制权租约、逐流增量读取、结构化控制与优雅终止：

```ts
export interface ProcessAPI {
  /** 一次性运行外部命令，等待其结束并收集有限输出 */
  run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult>;

  /** 创建长期受管进程资源并返回可寻址元数据与初始输出游标 */
  start(input: ProcessStartInput, call?: CallOptions): Promise<ProcessStartResult>;

  /** 查看指定受管进程资源的当前最新状态 */
  inspect(id: string, call?: CallOptions): Promise<ProcessInfo>;

  /** 列出当前作用域内可见的受管进程资源 */
  list(input: ProcessListInput, call?: CallOptions): Promise<ProcessListResult>;

  /** 申请指定受管进程的独占控制令牌 */
  acquire(id: string, input: ProcessAcquireInput, call?: CallOptions): Promise<ControlGrant>;

  /** 延长当前有效控制令牌的存活时间 */
  renew(id: string, token: string, ttlMs: number, call?: CallOptions): Promise<ControlGrant>;

  /** 显式释放控制令牌，允许后续控制者申请 */
  release(id: string, token: string, call?: CallOptions): Promise<void>;

  /** 向受管进程输入流写入原始字节数据 */
  write(id: string, input: ProcessWriteInput, call?: CallOptions): Promise<OperationReceipt>;

  /** 查询指定请求标识的输入或控制操作执行收据 */
  operation(id: string, requestId: string, call?: CallOptions): Promise<OperationReceipt>;

  /** 按游标读取受管进程的有界原始字节输出流 */
  read(id: string, input: ProcessReadInput, call?: CallOptions): Promise<ReadResult>;

  /** 向受管进程发送结构化控制指令 */
  control(id: string, input: ProcessControlInput, call?: CallOptions): Promise<OperationReceipt>;

  /** 终止指定的受管进程资源 */
  stop(id: string, input: ProcessStopInput, call?: CallOptions): Promise<ProcessInfo>;
}
```

#### 核心输入与返回类型定义

一次性运行类型：

```ts
export interface ProcessRunInput {
  /** 启动规范配置 */
  spec: LaunchSpec;
  /** 超时时限（毫秒） */
  timeoutMs: number;
  /** 收集输出的最大字节数 */
  maxOutputBytes: number;
}

export interface ProcessRunResult {
  /** 进程退出状态 */
  exit: { code: number | null; signal: string | null };
  /** 收集到的输出数据块列表 */
  chunks: OutputChunk[];
  /** 输出是否因达到上限被截断 */
  truncated: boolean;
}
```

启动与元数据类型：

```ts
export interface LaunchSpec {
  /** 可执行文件路径或名称 */
  executable: string;
  /** 启动参数列表 */
  args: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量配置 */
  env?: {
    inherit: "none" | "allowlisted";
    set?: Record<string, string>;
    unset?: string[];
  };
  /** 输入输出模式与终端配置 */
  io: { mode: "pipe" } | { mode: "pty"; cols: number; rows: number; term: string };
}

export interface Limits {
  /** 空闲超时上限（毫秒） */
  idleMs?: number;
  /** 存活时长上限（毫秒） */
  lifetimeMs?: number;
  /** 输出缓冲区容量字节上限 */
  outputBufferBytes?: number;
}

export interface ProcessInfo {
  id: string;
  hostEpoch: string;
  state: "starting" | "running" | "stopping" | "exited" | "failed" | "lost";
  control: "free" | "held" | "quarantined" | "closed";
  io: LaunchSpec["io"];
  capabilities: Capabilities;
  createdAt: string;
  exit?: { code: number | null; signal: string | null };
  endReason?: "natural" | "requested" | "idle" | "lifetime" | "revoked" | "input-failure" | "host-lost" | "spawn-failure";
  outputClosed: boolean;
  outputEndReason?: "natural" | "drain-timeout" | "host-lost";
  effectiveLimits: Required<Limits>;
}
```

独占控制与读写交互类型：

```ts
export interface ControlGrant {
  /** 控制令牌字符串 */
  token: string;
  /** 凭据有效截止时间（UTC ISO 8601 格式） */
  expiresAt: string;
}

export interface ProcessWriteInput {
  token: string;
  requestId: string;
  data: Bytes;
}

export interface ProcessControlInput {
  token: string;
  requestId: string;
  action:
    | { type: "input-eof" }
    | { type: "interrupt-foreground" }
    | { type: "resize"; cols: number; rows: number };
}

export interface ProcessReadInput {
  cursor: string;
  maxBytes: number;
  waitMs: number;
  onGap: "error" | "skip";
}

export interface ReadResult {
  chunks: OutputChunk[];
  nextCursor: string;
  earliestCursor: string;
  tailCursor: string;
  truncated: boolean;
  gap?: { fromCursor: string; toCursor: string };
  eof: boolean;
  process: ProcessInfo;
}
```

#### SDK 辅助函数与工具库

SDK 导出了针对受管进程交互的高阶工具函数：

- `withControl(api, processId, options, fn)`：在独占控制权保护下安全执行。内部自动申请令牌、按三分之一 TTL 周期自动续租、正常执行完毕后显式调用 `release`；若发生异常或中断则严禁调用 `release`，主动调用 `stop` 隔离或终止并向外抛出原错误。
- `createStreamDecoder()`（别名 `createIncrementalTextDecoder()`）：创建逐流增量 UTF-8 解码器，针对不同输出流（`stdout`、`stderr`、`pty`）独立缓存残缺多字节字符，杜绝切块乱码与跨流污染。
- `encodeText(text)` 与 `encodeBytes(data)`：将纯文本或二进制数据编码为标准的 Base64 `Bytes` 结构。
- `decodeText(bytesOrChunks)` 与 `decodeBytes(bytes)`：将 `Bytes` 结构或 `OutputChunk` 数组快速转换为 UTF-8 文本或二进制数组。

#### 使用示例

一次性命令执行：

```ts
import { defineAction, decodeText } from "@actiondock/sdk";

export default defineAction(async (_input, ctx) => {
  const res = await ctx.process.run(
    {
      spec: {
        executable: "git",
        args: ["log", "-1", "--format=%H %s"],
        io: { mode: "pipe" },
      },
      timeoutMs: 5000,
      maxOutputBytes: 1024 * 1024,
    },
    { signal: ctx.signal }
  );

  if (res.exit.code !== 0) {
    ctx.log.error(`Git 执行失败，退出码: ${res.exit.code}`);
    return { commit: null };
  }

  return { commit: decodeText(res.chunks).trim() };
});
```

长期进程交互与控制权治理：

```ts
import { defineAction, encodeText, withControl, createStreamDecoder } from "@actiondock/sdk";

export default defineAction(async (input: { command: string }, ctx) => {
  const started = await ctx.process.start({
    requestId: `start-${ctx.run.id}`,
    spec: { executable: "bash", args: ["--norc"], io: { mode: "pipe" } },
  });

  const decoder = createStreamDecoder();

  const output = await withControl(
    ctx.process,
    started.process.id,
    { requestId: `ctl-${ctx.run.id}`, ttlMs: 15000 },
    async (grant) => {
      await ctx.process.write({
        token: grant.token,
        requestId: `write-${ctx.run.id}`,
        data: encodeText(`${input.command}\n`),
      });

      const res = await ctx.process.read({
        cursor: started.initialCursor,
        maxBytes: 32 * 1024,
        waitMs: 1000,
        onGap: "skip",
      });

      return decoder.decodeChunks(res.chunks);
    }
  );

  return { output };
});
```

---

### 结构化日志接口 `Logger`

日志物理定向输出至标准错误流，避免污染标准输出的数据流：

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

---

### 任务进度报告接口 `ProgressReporter`

在耗时任务中向订阅者推送阶段进度：

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
