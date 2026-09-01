/**
 * CLI 执行选项配置。
 */
export interface ExecCliOptions {
  /**
   * 子进程工作目录，默认为当前工作目录 (process.cwd())。
   */
  cwd?: string;

  /**
   * 自定义环境变量字典（合并到 process.env 之上）。
   */
  env?: Record<string, string>;

  /**
   * 协作式取消信号（如 ActionContext 中的 ctx.signal）。
   * 若信号在执行前或执行期间触发，将安全中断或拒绝执行。
   */
  signal?: AbortSignal;

  /**
   * 单条命令超时时间（单位：毫秒）。
   * 超时后将向子进程发送终止信号强制结束，并标记 timedOut 为 true。
   */
  timeout?: number;

  /**
   * 写入子进程标准输入（stdin）的文本或原始二进制数据。
   */
  input?: string | Uint8Array;

  /**
   * 输出文本的解码字符集（默认为 "utf-8"，支持 "gbk" 等跨平台字符集）。
   */
  encoding?: string;

  /**
   * 当命令执行失败（非零退出码或超时）时是否直接抛出 Error（默认为 false）。
   * 设为 true 时，可省去手动 if (!res.ok) 校验。
   */
  throwOnError?: boolean;
}

/**
 * CLI 执行结果结构体。
 */
export interface ExecCliResult {
  /** 命令是否成功退出（即 exitCode === 0 且未发生超时或中断） */
  ok: boolean;
  /** 进程退出码（若未找到命令、超时或信号中断等异常时为 -1） */
  exitCode: number;
  /** 解码并去除首尾空白后的标准输出文本 */
  stdout: string;
  /** 解码并去除首尾空白后的标准错误文本 */
  stderr: string;
  /** 原始标准输出字节流（用于图片、音频、压缩包等二进制数据处理） */
  raw: Uint8Array;
  /** 是否因超时强制终止 */
  timedOut?: boolean;
  /** 命令执行总耗时（毫秒） */
  durationMs: number;
}

/**
 * 跨平台、防管道死锁的同步 CLI 命令调度器。
 * 
 * 核心特性与设计原则：
 * 1. **Windows .cmd 兼容**：自动通过 `Bun.which()` 解析 Windows 平台下的 `.cmd` / `.bat` / `.exe` 物理绝对路径；
 * 2. **防管道死锁**：采用 `Bun.spawnSync` 同步排空（Drain）管道并关闭句柄，彻底避免无头浏览器/Node 子进程因句柄残留导致异步流挂起；
 * 3. **超时与取消安全**：支持毫秒级 `timeout` 超时强杀与 `signal` (AbortSignal) 取消信号；
 * 4. **标准输入与二进制支持**：支持 `input` 管道灌入与 `raw` 原始二进制字节流输出；
 * 5. **耗时度量与编码支持**：自动统计 `durationMs`，支持自定义 `encoding`（如 Windows GBK/CP936 解码）；
 * 6. **灵活判定与快速抛错**：默认返回 `ok: false` 供业务层分支判定，亦可通过 `throwOnError: true` 自动抛错。
 * 
 * @param command 可执行命令名称或路径（如 "git", "agent-browser", "docker", "jq"）
 * @param args 传递给命令的参数列表（默认为 []）
 * @param options 运行选项（工作目录、环境变量、取消信号、超时、stdin、字符编码、抛错开关）
 * @returns ExecCliResult 执行结果结构体
 */
export function execCli(
  command: string,
  args: string[] = [],
  options: ExecCliOptions = {}
): ExecCliResult {
  const startTime = performance.now();

  // 1. 检查取消信号
  if (options.signal?.aborted) {
    const errRes: ExecCliResult = {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "Command aborted before execution by signal",
      raw: new Uint8Array(0),
      durationMs: 0,
    };
    if (options.throwOnError) {
      throw new Error(errRes.stderr);
    }
    return errRes;
  }

  // 2. 跨平台绝对路径解析（解决 Windows 下 npm 全局 .cmd shim 识别问题）
  const hasPathSep = command.includes("/") || command.includes("\\");
  const binPath = hasPathSep ? command : (Bun.which(command) || command);

  if (!hasPathSep && !Bun.which(command)) {
    const errRes: ExecCliResult = {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: `Command '${command}' not found in PATH.`,
      raw: new Uint8Array(0),
      durationMs: Math.round(performance.now() - startTime),
    };
    if (options.throwOnError) {
      throw new Error(errRes.stderr);
    }
    return errRes;
  }

  // 3. 处理标准输入数据
  let stdinOption: Uint8Array | "ignore" | undefined = "ignore";
  if (options.input !== undefined) {
    if (typeof options.input === "string") {
      stdinOption = new TextEncoder().encode(options.input);
    } else if (options.input instanceof Uint8Array) {
      stdinOption = options.input;
    }
  }

  try {
    const proc = Bun.spawnSync([binPath, ...args], {
      cwd: options.cwd || process.cwd(),
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdin: stdinOption,
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeout,
    });

    const durationMs = Math.round(performance.now() - startTime);
    const timedOut = Boolean((proc as any).exitedDueToTimeout);

    // 4. 自定义字符集解码
    const decoder = new TextDecoder(options.encoding || "utf-8");
    const rawStdout = proc.stdout ? new Uint8Array(proc.stdout) : new Uint8Array(0);
    const rawStderr = proc.stderr ? new Uint8Array(proc.stderr) : new Uint8Array(0);

    const stdout = rawStdout.length > 0 ? decoder.decode(rawStdout).trim() : "";
    let stderr = rawStderr.length > 0 ? decoder.decode(rawStderr).trim() : "";

    if (timedOut && !stderr) {
      stderr = `Command '${command}' timed out after ${options.timeout}ms`;
    }

    const exitCode = timedOut ? -1 : (proc.exitCode ?? (proc.success ? 0 : -1));
    const ok = !timedOut && exitCode === 0;

    const result: ExecCliResult = {
      ok,
      exitCode,
      stdout,
      stderr,
      raw: rawStdout,
      timedOut: timedOut || undefined,
      durationMs,
    };

    if (options.throwOnError && !ok) {
      throw new Error(stderr || `Command '${command}' failed with exit code ${exitCode}`);
    }

    return result;
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime);
    const errRes: ExecCliResult = {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: err?.message || String(err),
      raw: new Uint8Array(0),
      durationMs,
    };
    if (options.throwOnError) {
      throw err;
    }
    return errRes;
  }
}

/**
 * 启动后台守护进程类 CLI 命令的选项配置。
 */
export interface SpawnDetachedOptions {
  /**
   * 可执行命令名称或路径（如 "agent-browser", "docker", "daemon"）。
   */
  command: string;

  /**
   * 传递给命令的参数列表（默认为 []）。
   */
  args?: string[];

  /**
   * 就绪探测回调函数（返回 true 表示守护进程已就绪或命令副作用已生效）。
   */
  probe: () => Promise<boolean> | boolean;

  /**
   * 轮询探测间隔时间（单位：毫秒，默认为 400ms）。
   */
  intervalMs?: number;

  /**
   * 总超时时间（单位：毫秒，默认为 30000ms）。
   */
  timeoutMs?: number;

  /**
   * 协作式取消信号（如 ActionContext 中的 ctx.signal）。
   */
  signal?: AbortSignal;

  /**
   * 子进程工作目录，默认为当前工作目录 (process.cwd())。
   */
  cwd?: string;

  /**
   * 自定义环境变量字典（合并到 process.env 之上）。
   */
  env?: Record<string, string>;
}

/**
 * 安全执行“会拉起后台守护进程”的 CLI 命令（如 agent-browser open）。
 *
 * 核心三步工作流：
 * 1. 异步 fire：stdio 全 ignore —— 确保后台 daemon 进程继承不到任何管道句柄，从根源杜绝管道 EOF 挂起；
 * 2. 等 CLI 进程自身退出：错开冷启动窗口，避免探测命令并发拉起第二个 daemon 导致冲突；
 * 3. 轮询探测就绪：执行轻量 probe 回调确认守护进程就绪或副作用生效。
 *
 * @param options 启动与探测配置项
 * @returns Promise<boolean> 若在超时前 probe 返回 true 则返回 true；若超时仍未就绪则返回 false
 */
export async function spawnDetached(options: SpawnDetachedOptions): Promise<boolean> {
  const { command, args = [], probe, signal, cwd, env } = options;
  const intervalMs = options.intervalMs ?? 400;
  const timeoutMs = options.timeoutMs ?? 30_000;

  // 1. 检查取消信号
  if (signal?.aborted) {
    throw new Error("Command aborted before execution by signal");
  }

  // 2. 跨平台绝对路径解析（解决 Windows 下 npm 全局 .cmd shim 识别问题）
  const hasPathSep = command.includes("/") || command.includes("\\");
  const binPath = hasPathSep ? command : (Bun.which(command) || command);

  if (!hasPathSep && !Bun.which(command)) {
    throw new Error(`Command '${command}' not found in PATH.`);
  }

  // 3. fire-and-forget：ignore 所有 stdio，unref 防止阻塞事件循环
  const child = Bun.spawn([binPath, ...args], {
    cwd: cwd || process.cwd(),
    env: env ? { ...process.env, ...env } : process.env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    signal,
  });
  child.unref();

  // 4. 等待 CLI 前端进程自身退出（错开冷启动窗口，避免 probe 并发拉起两个 daemon）
  try {
    await child.exited;
  } catch (err) {
    if (signal?.aborted) {
      throw new Error("aborted");
    }
    throw err;
  }

  if (signal?.aborted) {
    throw new Error("aborted");
  }

  // 5. 轮询探测就绪
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("aborted");
    }

    try {
      const ready = await probe();
      if (ready) {
        return true;
      }
    } catch (probeErr) {
      if (signal?.aborted) {
        throw new Error("aborted");
      }
      // probe 异常通常为守护进程未完全就绪时的暂时性错误，继续等待轮询
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const sleepTime = Math.min(intervalMs, remaining);
    await new Promise((resolve) => setTimeout(resolve, sleepTime));
  }

  return false;
}
