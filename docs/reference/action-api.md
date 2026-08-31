# 参考手册：Action SDK API (@actiondock/sdk)

`@actiondock/sdk` 是编写 ActionDock Action 与单元测试的核心轻量库。

---

## 1. `defineAction`

声明一个标准 Action 定义：

```ts
function defineAction<TInput = any, TOutput = any>(
  def: ActionDefinition<TInput, TOutput>
): ActionDefinition<TInput, TOutput>;
```

### `ActionDefinition` 接口
```ts
export interface ActionDefinition<TInput = any, TOutput = any> {
  /** 全局唯一 Action 标识符（如 github.get-pr） */
  id: string;

  /** 面向人类与 LLM 的功能描述 */
  description: string;

  /** 入参 JSON Schema（用于 Ajv 校验与 MCP Tool 发现） */
  inputSchema: Record<string, any>;

  /** 出参 JSON Schema（用于 Ajv 校验与类型保证） */
  outputSchema?: Record<string, any>;

  /** 核心执行逻辑函数 */
  run(input: TInput, ctx: ActionContext): Promise<TOutput>;
}
```

---

## 2. `ActionContext` 接口

```ts
export interface ActionContext {
  /** 5 级优先级配置存储 */
  config: ConfigStore;

  /** SQLite 状态持久化存储 */
  state: StateStore;

  /** Action 间级联调用器（带循环调用保护） */
  actions: ActionInvoker;

  /** 隔离写入 stderr 的结构化日志记录器 */
  log: Logger;

  /** 协作式取消信号 */
  signal?: AbortSignal;
}
```

### `ConfigStore`
```ts
export interface ConfigStore {
  get<T = any>(key: string, defaultValue?: T): T | undefined;
}
```

### `StateStore`
```ts
export interface StateStore {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: any, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<Record<string, any>>;
  namespace(ns: string): StateStore;
}
```

### `ActionInvoker`
```ts
export interface ActionInvoker {
  invoke<TInput = any, TOutput = any>(
    actionId: string,
    input?: TInput,
    options?: { config?: Record<string, any> }
  ): Promise<TOutput>;
}
```

### `Logger`
```ts
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
```

---

## 3. `createTestRuntime`

创建极速纯内存测试沙箱：

```ts
function createTestRuntime(options?: TestRuntimeOptions): TestRuntime;

export interface TestRuntimeOptions {
  config?: Record<string, any>;
  initialState?: Record<string, any>;
  actions?: Record<string, ActionDefinition<any, any>>;
}

export interface TestRuntime {
  execute<TInput, TOutput>(
    action: ActionDefinition<TInput, TOutput>,
    input: TInput
  ): Promise<TOutput>;
  state: StateStore;
  logs: Array<{ level: string; message: string; timestamp: string }>;
}
```

---

## 4. `execCli` 跨平台 CLI 调度与防死锁

`@actiondock/sdk` 内置了 `execCli` 辅助函数，专门用于在 Action 中安全调用系统外部 CLI 工具（如 `agent-browser`、`git`、`docker` 等），解决了 Windows `.cmd` 识别、管道挂死与信号取消问题。

### 核心特性
1. **Windows `.cmd` 兼容**：自动通过 `Bun.which("command")` 解析 Windows 平台的 `.cmd` / `.bat` / `.exe` 物理绝对路径。
2. **防管道死锁**：使用 `Bun.spawnSync` 一次性同步排空（Drain）管道，彻底避免浏览器/后台子进程因文件句柄继承导致异步流挂起。
3. **取消信号与错误安全**：支持传入 `ctx.signal`；非零退出码不自动 throw Error，返回 `ok: false` 与对应退出码。

### 类型签名与使用示例

```ts
import { defineAction, execCli, type ExecCliOptions, type ExecCliResult } from "@actiondock/sdk";

export default defineAction({
  id: "browser.query",
  async run(input, ctx) {
    // 检查取消信号
    if (ctx.signal.aborted) throw new Error("Aborted");

    // 一行安全调用外部 CLI
    const res = execCli("agent-browser", ["wait", "--timeout", "5s"], {
      cwd: process.cwd(),
      signal: ctx.signal,
    });

    if (!res.ok) {
      ctx.log.warn(`命令执行未成功 (code ${res.exitCode}): ${res.stderr}`);
    }

    return { output: res.stdout };
  },
});
```

#### 函数类型定义：
```ts
export interface ExecCliOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExecCliResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function execCli(
  command: string,
  args?: string[],
  options?: ExecCliOptions
): ExecCliResult;
```


