import type { ProcessAPI } from "@actiondock/sdk";

/**
 * 进程执行器统一契约别名。
 *
 * 面向宿主与上层服务的进程能力均以 ProcessAPI 接口为准，
 * 具体实现由各平台适配层（如 NodeProcessExecutor）提供。
 */
export type ProcessExecutor = ProcessAPI;
