import {
  StandaloneDispatcher as CoreStandaloneDispatcher,
  type StandaloneDispatcherOptions,
} from "@actiondock/core";
import type { StandaloneOptions } from "../types";

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
  options: StandaloneOptions
): Promise<number> {
  const dispatcher = new StandaloneDispatcher(options);
  return dispatcher.dispatch(argv);
}

/**
 * 创建独立二进制运行时分发器实例。
 */
export function createStandaloneDispatcher(options: StandaloneOptions): StandaloneDispatcher {
  return new StandaloneDispatcher(options);
}
