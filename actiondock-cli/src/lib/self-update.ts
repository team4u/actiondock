import { spawn } from "node:child_process";

import { ActionDockCliError } from "./error.js";

export interface SelfUpdatePlan {
  executable: string;
  args: string[];
  packageName: string;
  target: string;
  command: string;
}

export function resolveSelfUpdateTarget(value: string | undefined): string {
  const target = value?.trim() || "latest";
  if (!target) {
    throw new ActionDockCliError("更新目标不能为空。", 2);
  }
  return target;
}

export function buildSelfUpdatePlan({
  packageName,
  target,
  platform = process.platform,
}: {
  packageName: string;
  target: string;
  platform?: NodeJS.Platform;
}): SelfUpdatePlan {
  const executable = "npm";
  const spec = `${packageName}@${target}`;
  const args = ["install", "-g", spec];

  return {
    executable,
    args,
    packageName,
    target,
    command: [executable, ...args].join(" "),
  };
}

export async function runSelfUpdatePlan(plan: SelfUpdatePlan): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(plan.executable, plan.args, {
      stdio: "inherit",
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new ActionDockCliError("找不到 `npm` 命令，无法执行自升级。", 1));
        return;
      }

      reject(error);
    });

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new ActionDockCliError(`自升级被信号中断: ${signal}`, 1));
        return;
      }

      resolve(code ?? 1);
    });
  });
}
