import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * 测试专用跨平台子进程执行辅助（单一事实源）。
 *
 * 设计约束：
 * - 以 node 可执行文件为唯一运行时（彻底去除 bun 残留）；
 * - Windows 的 CreateProcess 无法直接执行 .mjs/.js/.ts 脚本（shebang 不生效），
 *   统一降级为 node <script> 调用；
 * - 返回值沿用既有测试契约的 { exitCode, stdout, stderr, signalCode } 形状，
 *   启动失败（res.error）时显式置为失败，避免错误被掩码成 exitCode 0 + 空输出。
 */

/** 将命令首段归一化为当前 node 运行时可执行的形态 */
function normalizeBin(cmdArray) {
  let [bin, ...args] = cmdArray;
  if (bin === "bun") {
    bin = process.execPath;
  }
  if (/\.(mjs|cjs|js|ts)$/i.test(bin)) {
    args = [bin, ...args];
    bin = process.execPath;
  }
  return [bin, ...args];
}

/**
 * 同步执行子进程命令并返回统一形状结果。
 *
 * @param cmdArray 命令段数组（首段可为 "bun"、node 可执行文件或脚本路径）
 * @param options 可选的 cwd、env、stdin 输入与 timeout 毫秒数
 */
export function runCommandSync(cmdArray, options = {}) {
  const [bin, ...args] = normalizeBin(cmdArray);
  const res = spawnSync(bin, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.stdin ?? options.input,
    timeout: options.timeout,
  });
  const stderrBuf = Buffer.isBuffer(res.stderr) ? res.stderr : Buffer.from(res.stderr || "");
  const errorBuf = res.error
    ? Buffer.from(`\n[spawnSync Error]: ${res.error.stack || res.error.message}\n`)
    : Buffer.alloc(0);
  const combinedStderr = res.error ? Buffer.concat([stderrBuf, errorBuf]) : stderrBuf;
  return {
    exitCode: res.error ? 1 : res.status ?? (res.signal ? 1 : 0),
    stdout: Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || ""),
    stderr: combinedStderr,
    signalCode: res.signal,
  };
}

/**
 * 异步启动子进程并挂载 exited 退出承诺（对齐既有测试对长驻服务进程的等待语义）。
 *
 * @param cmdArray 命令段数组
 * @param options 可选的 cwd、env、stdio 与 detached 配置
 */
export function startCommand(cmdArray, options = {}) {
  const [bin, ...args] = normalizeBin(cmdArray);
  const proc = spawn(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? [
      options.stdin ? "pipe" : "ignore",
      options.stdout ?? "pipe",
      options.stderr ?? "pipe",
    ],
    detached: options.detached ?? (process.platform !== "win32"),
  });
  const exited = new Promise((resolve) => {
    proc.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    proc.on("error", () => resolve(1));
  });
  proc.exited = exited;
  return proc;
}

/**
 * PATH 检索可执行文件（与 core 的 findExecutable 行为对齐）：
 * Windows 下对无点命令追加 PATHEXT 扩展名、其余直接拼接。
 *
 * @param command 待检索的命令名
 * @returns 命中返回可执行文件绝对路径，未命中返回 null
 */
export function whichExecutable(command) {
  const hasPathSep = command.includes("/") || command.includes("\\");
  if (hasPathSep) {
    return existsSync(command) ? command : null;
  }
  const dirs = (process.env.PATH || "").split(delimiter);
  const isWindows = process.platform === "win32";
  const pathext = isWindows
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of pathext) {
      const candidate = join(dir, isWindows && !command.includes(".") ? command + ext : command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
