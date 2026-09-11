import { spawn } from "node:child_process";

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
