import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export interface RunCommandOptions {
  cwd?: string;
  allowFailure?: boolean;
  captureOutput?: boolean;
}

/** 创建绑定默认工作目录的工程脚本命令执行器。 */
export function createCommandRunner(defaultCwd: string) {
  return function runCmd(
    cmd: string,
    args: string[],
    options: RunCommandOptions = {}
  ): SpawnSyncReturns<string> {
    const result = spawnSync(cmd, args, {
      cwd: options.cwd || defaultCwd,
      encoding: "utf8",
      stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
    });

    if (result.status !== 0 && !options.allowFailure) {
      const errorMsg = result.error?.message ?? (options.captureOutput
        ? (result.stderr || result.stdout || "").trim()
        : `命令执行失败，退出码: ${result.status}`);
      throw new Error(`执行失败: ${cmd} ${args.join(" ")}\n${errorMsg}`);
    }

    return result;
  };
}
