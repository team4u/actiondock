export * from "./sqlite-driver";
export * from "./process-executor";
export * from "./process-driver";
export * from "./module-loader";
export * from "./http-server";
export * from "./platform";
export * from "./dispatcher";

// 入口聚合点显式安装平台调度器：
// 任何宿主导入 @actiondock/runtime-node 入口即完成 core 侧调度器注册，
// 保持既有「导入即注册」的行为预期（如 test-preload 与 core 的动态回退链路）；
// 副作用收敛在入口而非深层模块，直接导入子模块时保持零副作用。
import { installInsecureDispatcher } from "./dispatcher";
installInsecureDispatcher();
