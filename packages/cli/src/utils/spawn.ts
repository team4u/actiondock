import { spawn } from "node:child_process";
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
 * 从源头消除 win32 shell 拼接模式下的命令注入面。
 */
const PACKAGE_SPEC_PATTERN = /^[a-zA-Z0-9@/:\-_.+]+$/;

/**
 * 校验包管理器依赖说明符仅包含白名单字符。
 * 非法字符直接抛出参数错误，不进入子进程拼接链路。
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
 * 异步执行子进程（Promise 化 spawn），保留 win32 shell 处理与退出码透传。
 *
 * 与 spawnSync 语义对齐：stdio 默认 pipe，进程结束（而非继承输出）后返回聚合结果。
 *
 * win32 shell 取舍说明：npm 在 Windows 上是 `.cmd` 批处理脚本，Node 20.12+
 * 针对 CVE-2024-27980 的缓解措施使 `shell:false` 直接 spawn `.cmd` 抛出 EINVAL，
 * 因此 win32 保留 shell 拼接模式；命令注入面由调用方的
 * assertSafePackageSpec 白名单前置校验关闭（包说明符仅允许
 * 字母数字与 `@/:/-_/.+`，全部 shell 元字符被拒绝）。
 *
 * @param command 可执行文件名
 * @param args 参数列表
 * @param options 附加选项（cwd 与 shell 策略）
 */
export function spawnAsync(
  command: string,
  args: string[],
  options?: { cwd?: string; shell?: boolean; stdio?: "pipe" | "inherit" }
): Promise<SpawnAsyncResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      stdio: options?.stdio ?? "pipe",
      shell: options?.shell ?? process.platform === "win32",
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
