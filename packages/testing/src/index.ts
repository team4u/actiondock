import { registerTestRuntimeProvider } from "@actiondock/sdk";
import { createTestRuntime } from "./runtime";

/**
 * 将 @actiondock/testing 注册为 @actiondock/sdk 中 createTestRuntime 的全局生产级实现。
 */
export function registerTestingAsSdkProvider(): void {
  registerTestRuntimeProvider(createTestRuntime);
}

export * from "./clock";
export * from "./process";
export * from "./storage";
export * from "./runtime";
