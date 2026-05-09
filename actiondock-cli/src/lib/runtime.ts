import { spawn } from "node:child_process";

import { ActionDockCliError } from "./error.js";

export type RuntimeCommand = "actiondock-runtime";

export async function runRuntimeCommand(
  command: RuntimeCommand,
  args: string[],
): Promise<number> {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });

    child.on("error", (error) => {
      reject(new ActionDockCliError(
        [
          `无法启动 ${command}。`,
          "请确认已经通过 `npm install -g actiondock` 安装，或在开发环境执行 `npm link` 后再测试。",
          `原始错误: ${error.message}`,
        ].join("\n"),
        1,
      ));
    });

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new ActionDockCliError(`${command} 被信号终止: ${signal}`, 1));
        return;
      }

      resolve(code ?? 1);
    });
  });
}
