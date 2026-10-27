import { spawn } from "node:child_process";
import {
  resolvePackageManagerInvocation,
  runPackageManager,
} from "@actiondock/core/project";
import { ArgumentError } from "../errors";

/**
 * npm/bun 包说明符白名单字符集。
 *
 * 覆盖 npm 依赖说明符语法所需的安全字符：
 * - 字母数字与 `.`（名称与版本组成）
 * - `@`（scope 前缀与版本定界符）、`/`（scope 分隔符）
 * - `:`（git 协议与 tag 前缀）、`-` 与 `_`（名称连字符与版本预发布段）
 * - `+`（semver build 元数据）
 *
 * 显式拒绝全部 shell 元字符（空格、引号、`$`、反引号、`&`、`|`、`<`、`>`、`(`、`)` 等），
 * 保障参数安全边界。
 */
const PACKAGE_SPEC_PATTERN = /^[a-zA-Z0-9@/:\-_.+]+$/;

/**
 * 校验包管理器依赖说明符仅包含白名单字符。
 * 非法字符直接抛出参数错误，不进入子进程执行链路。
 *
 * @param spec 待校验的包说明符（如 `@scope/pkg@^1.2.3`）
 */
export function assertSafePackageSpec(spec: string): void {
  if (!PACKAGE_SPEC_PATTERN.test(spec)) {
    throw new ArgumentError(
      `Invalid package specifier '${spec}': only letters, digits, '@', '/', ':', '-', '_', '.', '+' are allowed`
    );
  }
}

/**
 * 子进程执行结果视图。
 */
export interface SpawnAsyncResult {
  /** 进程退出码（null 表示被信号终止） */
  status: number | null;
  /** 终止信号名称 */
  signal: string | null;
  /** 标准输出内容 */
  stdout: string;
  /** 标准错误内容 */
  stderr: string;
}

/**
 * 异步执行子进程薄兼容入口。
 *
 * 契约规范：
 * - 针对 npm 与 bun 包管理器调用，统一复用 resolvePackageManagerInvocation 进行平台定位与参数边界解析，
 *   以 shell: false 执行，彻底消除 DEP0190 警告与命令注入隐患；
 * - pipe 模式优先经由统一包管理器驱动执行；
 * - inherit 模式保留真实的 stdin/stdout/stderr 继承与 TTY 交互语义；
 * - 内部包管理器调用严禁设置 shell: true。
 *
 * @param command 可执行文件名
 * @param args 参数列表
 * @param options 附加选项（cwd、shell、stdio 与 env）
 */
export async function spawnAsync(
  command: string,
  args: string[],
  options?: { cwd?: string; shell?: boolean; stdio?: "pipe" | "inherit"; env?: NodeJS.ProcessEnv }
): Promise<SpawnAsyncResult> {
  if (command === "npm" || command === "bun") {
    if (options?.stdio !== "inherit") {
      const result = await runPackageManager(command, args, {
        cwd: options?.cwd,
        env: options?.env as Record<string, string | undefined> | undefined,
      });
      return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    const invocation = resolvePackageManagerInvocation(command, args, {
      cwd: options?.cwd,
      env: options?.env as Record<string, string | undefined> | undefined,
    });

    return new Promise((resolve, reject) => {
      const proc = spawn(invocation.executable, invocation.args, {
        cwd: options?.cwd,
        stdio: "inherit",
        shell: false,
        env: options?.env,
      });

      proc.on("error", reject);
      proc.on("close", (status, signal) => {
        resolve({ status, signal: signal ?? null, stdout: "", stderr: "" });
      });
    });
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      stdio: options?.stdio ?? "pipe",
      shell: options?.shell ?? false,
      env: options?.env,
    });

    let stdout = "";
    let stderr = "";

    if (proc.stdout) {
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    proc.on("error", reject);
    proc.on("close", (status, signal) => {
      resolve({ status, signal: signal ?? null, stdout, stderr });
    });
  });
}
