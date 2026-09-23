import {
  StandaloneDispatcher as CoreStandaloneDispatcher,
  type StandaloneDispatcherOptions,
  type InvocationControl,
} from "@actiondock/core";
import type { StandaloneOptions } from "../types";

export { type InvocationControl };

/**
 * 独立二进制轻量参数解析分发器（委托 Core 统一实现，消除重复逻辑）。
 */
export class StandaloneDispatcher extends CoreStandaloneDispatcher {
  constructor(options: StandaloneOptions) {
    super(options as StandaloneDispatcherOptions);
  }
}

/**
 * 运行独立二进制参数解析分发器并返回退出状态码。
 */
export async function runStandaloneCli(
  argv: string[] = process.argv.slice(2),
  options: StandaloneOptions,
  control?: InvocationControl
): Promise<number> {
  const dispatcher = new StandaloneDispatcher(options);
  return dispatcher.dispatch(argv, control);
}

/**
 * 创建独立二进制运行时分发器实例。
 */
export function createStandaloneDispatcher(options: StandaloneOptions): StandaloneDispatcher {
  return new StandaloneDispatcher(options);
}

/**
 * 独立二进制进程入口适配器。
 * 仅在命令行可执行入口调用，负责全局 SIGINT 监听与退出状态码写入。
 */
export async function runStandaloneProcess(
  argv: string[] = process.argv.slice(2),
  options: StandaloneOptions
): Promise<void> {
  const controller = new AbortController();
  const control: InvocationControl = {
    signal: controller.signal,
  };
  let sigintCount = 0;
  const sigintHandler = () => {
    sigintCount++;
    if (sigintCount === 1) {
      control.cancellationSource = "sigint";
      controller.abort(new Error("Interrupted by SIGINT"));
    } else {
      process.exitCode = 130;
      process.exit(130);
    }
  };
  process.on("SIGINT", sigintHandler);
  try {
    const exitCode = await runStandaloneCli(argv, options, control);
    process.exitCode = exitCode;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

