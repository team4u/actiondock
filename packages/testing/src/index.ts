import { registerTestRuntimeProvider } from "@actiondock/sdk";
import { createTestRuntime } from "./runtime";

/**
 * 将 @actiondock/testing 注册为 @actiondock/sdk 中 createTestRuntime 的全局生产级实现。
 */
export function registerTestingAsSdkProvider(): void {
  registerTestRuntimeProvider(createTestRuntime);
}

// 自动在模块导入时注册为 SDK 测试运行时提供者
registerTestingAsSdkProvider();

export * from "./clock";
export * from "./process";
export * from "./storage";
export * from "./runtime";
