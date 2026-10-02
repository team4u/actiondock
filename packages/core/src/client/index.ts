/**
 * ActionDock 核心远程 HTTP 客户端模块。
 *
 * 遵循架构收敛设计规范：按资源域组织，传输层单点。
 * 彻底从 profile 目录解耦移入独立 client 模块。
 */

// 1. 传输层单点
export {
  assertSecureTransport,
  buildHeaders,
  buildQueryString,
  buildQueryStringPreservingEmpty,
  createRemoteFetch,
  fetchRemoteJson,
  fetchRemoteRoute,
  normalizeServerUrl,
} from "./transport";
export type {
  RemoteClientRequestOptions,
  RemoteFetchInit,
  SecureTransportOptions,
} from "./transport";

// 2. 健康检查域
export { checkRemoteHealth } from "./health";
export type { RemoteHealthResult } from "./health";

// 3. Action 执行与查询域
export {
  executeRemoteAction,
  fetchRemoteActionShow,
  fetchRemoteActions,
  fetchRemoteDoctor,
  fetchRemoteInfo,
} from "./actions";
export type { RemoteExecuteOptions, RemoteExecutionResult } from "./actions";

// 4. Playbook 规程查询域
export { fetchRemotePlaybookShow, fetchRemotePlaybooks } from "./playbooks";

// 5. 运行记录管理域
export {
  cancelRemoteRun,
  cleanExpiredRemoteRuns,
  clearRemoteRuns,
  fetchRemoteRun,
  fetchRemoteRuns,
} from "./runs";

// 6. 状态存储管理域
export {
  clearRemoteState,
  deleteRemoteStateKey,
  fetchRemoteStateList,
  getRemoteStateKey,
  setRemoteStateKey,
} from "./state";

// 7. 配置管理域
export {
  deleteRemoteConfig,
  fetchRemoteConfig,
  fetchRemoteConfigEnv,
  setRemoteConfig,
} from "./config";
