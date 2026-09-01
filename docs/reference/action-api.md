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

### `Config`
```ts
export interface Config {
  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  has(key: string): boolean;
}
```

### `StateStore`
```ts
export interface StateStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  scope(namespace: string): StateStore;
}
```

### `ActionInvoker`
```ts
export interface ActionInvoker {
  invoke<I, O>(
    action: ActionDefinition<I, O>,
    input: I
  ): Promise<O>;
}
```

### `Logger`
```ts
export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}
```

---

## 3. `createTestRuntime`

创建极速纯内存测试沙箱：

```ts
function createTestRuntime(options?: TestRuntimeOptions): TestRuntime;

export interface TestRuntimeOptions {
  config?: Record<string, unknown>;
  state?: Record<string, unknown>;
  logger?: Logger;
  signal?: AbortSignal;
}

export interface TestRuntime {
  config: MemoryConfig;
  state: MemoryStateStore;
  logger: MemoryLogger;
  run<I, O>(
    action: ActionDefinition<I, O>,
    input: I
  ): Promise<O>;
}
```

---

## 4. `execCli` 跨平台 CLI 调度与防死锁

`@actiondock/sdk` 内置了企业级 `execCli` 辅助函数，专门用于在 Action 中安全调用系统外部 CLI 工具（如 `agent-browser`、`git`、`docker`、`jq` 等），彻底解决 Windows `.cmd` 识别、管道死锁挂起、超时控制与取消响应问题。

### 核心特性
1. **Windows `.cmd` 兼容**：自动通过 `Bun.which("command")` 解析 Windows 平台的 `.cmd` / `.bat` / `.exe` 物理绝对路径。
2. **防管道死锁**：使用 `Bun.spawnSync` 一次性同步排空（Drain）管道并关闭句柄，彻底避免无头浏览器/后台守护进程因句柄继承导致流读取挂起。
3. **毫秒级超时与取消安全**：支持 `timeout` 毫秒超时强杀与 `signal` (AbortSignal) 取消响应。
4. **标准输入与二进制支持**：支持 `input` 管道写入（如传 JSON 给 `jq`）与 `raw` 原始二进制字节流输出（图片/音视频/压缩包）。
5. **耗时度量与编码支持**：自动统计 `durationMs`，支持自定义 `encoding`（如 Windows GBK/CP936 解码）。
6. **灵活判定与快速抛错**：默认返回 `ok: false` 供业务层分支判定，亦可通过 `throwOnError: true` 自动抛错。

### 类型签名与使用示例

```ts
import { defineAction, execCli } from "@actiondock/sdk";

export default defineAction({
  id: "browser.query",
  async run(input, ctx) {
    // 一行安全调用外部 CLI（支持超时、取消与 stdin 灌入）
    const res = execCli("agent-browser", ["wait", "--timeout", "5s"], {
      cwd: process.cwd(),
      signal: ctx.signal,
      timeout: 5000,
    });

    if (res.timedOut) {
      ctx.log.warn("命令执行超时，进入降级逻辑");
      return { matched: false };
    }

    if (!res.ok) {
      ctx.log.warn(`命令执行未成功 (code ${res.exitCode}): ${res.stderr}`);
      return { matched: false };
    }

    ctx.log.info(`执行耗时: ${res.durationMs}ms`);
    return { output: res.stdout };
  },
});
```

#### 完整接口定义：
```ts
export interface ExecCliOptions {
  /** 子进程工作目录（默认 process.cwd()） */
  cwd?: string;
  /** 自定义环境变量 */
  env?: Record<string, string>;
  /** 协作式取消信号（如 ctx.signal） */
  signal?: AbortSignal;
  /** 单条命令超时毫秒数，超时自动强杀子进程 */
  timeout?: number;
  /** 写入子进程 stdin 的文本或二进制数据 */
  input?: string | Uint8Array;
  /** 字符编码集（默认 "utf-8"，支持 "gbk" 等） */
  encoding?: string;
  /** 失败时是否直接抛出 Error（默认 false） */
  throwOnError?: boolean;
}

export interface ExecCliResult {
  /** 命令是否成功退出（exitCode === 0 且未超时） */
  ok: boolean;
  /** 进程退出码（未找到命令或中断时为 -1） */
  exitCode: number;
  /** 解码并 trim 后的标准输出文本 */
  stdout: string;
  /** 解码并 trim 后的标准错误文本 */
  stderr: string;
  /** 原始标准输出字节流（用于图片、二进制文件处理） */
  raw: Uint8Array;
  /** 是否因超时强制终止 */
  timedOut?: boolean;
  /** 命令执行耗时（毫秒） */
  durationMs: number;
}

export function execCli(
  command: string,
  args?: string[],
  options?: ExecCliOptions
): ExecCliResult;
```

---

## 5. `spawnDetached` 守护进程 CLI 异步启动与就绪探测

当 CLI 命令首次拉起常驻后台守护进程（如 `agent-browser open` 会拉起常驻 daemon 进程）：
- **管道 EOF 死锁**：使用常规同步 `execCli` (`Bun.spawnSync`) 收集标准流时，后台 daemon 进程继承了 stderr/stdout 管道句柄且常驻不释放，导致管道永远无法接收 EOF，命令挂满超时。
- **并发冲突**：若不等待 CLI 前端退出即并发发送探测命令，可能同时拉起多个 daemon 导致配置冲突。

`spawnDetached` 提供 **stdio ignore 异步 fire + 等待 CLI 退出 + 轮询 probe 就绪** 的三步闭环机制：

### 类型签名与使用示例

```ts
import { defineAction, execCli, spawnDetached } from "@actiondock/sdk";

export default defineAction({
  id: "browser.open-page",
  async run(input: { url: string }, ctx) {
    let prevUrl = "", stableCount = 0;

    const ok = await spawnDetached({
      command: "agent-browser",
      args: ["open", input.url, "--timeout", "30s"],
      signal: ctx.signal,
      intervalMs: 400,
      timeoutMs: 30000,
      probe: async () => {
        // warm daemon 状态下管道安全，通过轻量 execCli 探测状态
        const r = execCli("agent-browser", ["get", "url"], { timeout: 5000 });
        const current = r.stdout.trim();
        // 就绪判定：URL 连续 3 次读取一致且非空白
        if (current && current === prevUrl && current !== "about:blank") {
          return ++stableCount >= 3;
        }
        stableCount = 0;
        prevUrl = current;
        return false;
      },
    });

    if (!ok) {
      throw new Error(`页面打开超时未就绪: ${input.url}`);
    }

    return { status: "ready" };
  },
});
```

#### 完整接口定义：
```ts
export interface SpawnDetachedOptions {
  /** 可执行命令名称或路径（如 "agent-browser"） */
  command: string;
  /** 传递给命令的参数列表（默认为 []） */
  args?: string[];
  /** 就绪探测回调函数（返回 true 表示就绪） */
  probe: () => Promise<boolean> | boolean;
  /** 轮询探测间隔时间（毫秒，默认 400） */
  intervalMs?: number;
  /** 总超时时间（毫秒，默认 30000） */
  timeoutMs?: number;
  /** 协作式取消信号（如 ctx.signal） */
  signal?: AbortSignal;
  /** 子进程工作目录 */
  cwd?: string;
  /** 自定义环境变量 */
  env?: Record<string, string>;
}

export function spawnDetached(
  options: SpawnDetachedOptions
): Promise<boolean>;
```




