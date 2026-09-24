import {
  StandaloneDispatcher as CoreStandaloneDispatcher,
  type InvocationControl,
} from "@actiondock/core/server";
import type { StandaloneOptions } from "../types";

export { type InvocationControl };

/**
 * 运行独立二进制参数解析分发器并返回退出状态码（委托 Core 统一实现）。
 */
export async function runStandaloneCli(
  argv: string[] = process.argv.slice(2),
  options: StandaloneOptions,
  control?: InvocationControl
): Promise<number> {
  const dispatcher = new CoreStandaloneDispatcher(options);
  return dispatcher.dispatch(argv, control);
}

/**
 * 独立二进制进程入口适配器（事实源位于 core 包，此处 re-export 维持既有导入路径兼容）。
 * 仅在命令行可执行入口调用，负责全局 SIGINT 监听与退出状态码写入。
 */
export { runStandaloneProcess } from "@actiondock/core/server";
