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
}

/**
 * CLI 执行结果结构体。
 */
export interface ExecCliResult {
  /** 命令是否成功退出（即 exitCode === 0） */
  ok: boolean;
  /** 进程退出码（若未找到命令或信号中断等异常时为 -1） */
  exitCode: number;
  /** 标准输出内容（已自动去除首尾空白） */
  stdout: string;
  /** 标准错误输出内容（已自动去除首尾空白） */
  stderr: string;
}

/**
 * 跨平台、防管道死锁的同步 CLI 命令调度器。
 * 
 * 核心特性与设计原则：
 * 1. **Windows .cmd 兼容**：自动通过 `Bun.which()` 解析 Windows 平台下的 `.cmd` / `.bat` / `.exe` 物理绝对路径；
 * 2. **防管道死锁**：采用 `Bun.spawnSync` 同步排空（Drain）管道并关闭句柄，彻底避免无头浏览器/Node 子进程因句柄残留导致异步流挂死；
 * 3. **安全取消响应**：检测 `signal` (AbortSignal) 取消信号；
 * 4. **非抛出式判定**：非零退出码不抛出异常，返回 `ok: false` 与退出码供业务层灵活判断。
 * 
 * @param command 可执行命令名称或路径（如 "git", "agent-browser", "docker"）
 * @param args 传递给命令的参数列表（默认为 []）
 * @param options 运行选项（工作目录、环境变量、取消信号）
 * @returns ExecCliResult 执行结果结构体
 */
export function execCli(
  command: string,
  args: string[] = [],
  options: ExecCliOptions = {}
): ExecCliResult {
  // 1. 检查取消信号
  if (options.signal?.aborted) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "Command aborted before execution by signal",
    };
  }

  // 2. 跨平台绝对路径解析（解决 Windows 下 npm 全局 .cmd shim 识别问题）
  const hasPathSep = command.includes("/") || command.includes("\\");
  const binPath = hasPathSep ? command : (Bun.which(command) || command);

  if (!hasPathSep && !Bun.which(command)) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: `Command '${command}' not found in PATH.`,
    };
  }

  try {
    const proc = Bun.spawnSync([binPath, ...args], {
      cwd: options.cwd || process.cwd(),
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = proc.stdout ? proc.stdout.toString().trim() : "";
    const stderr = proc.stderr ? proc.stderr.toString().trim() : "";

    return {
      ok: proc.exitCode === 0,
      exitCode: proc.exitCode ?? (proc.success ? 0 : -1),
      stdout,
      stderr,
    };
  } catch (err: any) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: err?.message || String(err),
    };
  }
}
