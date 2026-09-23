/**
 * 远端 Profile 客户端聚合入口。
 *
 * 历史上全部端点函数集中于单一 client.ts（约 950 行），现按域拆分为
 * 单一职责模块，此处仅保留聚合 re-export，导入路径 ./client 与
 * @actiondock/core 的公共导出面保持完全兼容。
 *
 * 模块划分：
 * - client-transport：传输层（鉴权头、明文校验、协议回退）
 * - client-query：共享请求与查询构造层
 * - client-health：健康检查
 * - client-actions：执行与 Action 查询
 * - client-playbooks：Playbook 规程查询
 * - client-runs：运行记录管理
 * - client-state：状态存储管理
 * - client-config：配置管理
 */

// 传输层与通用类型
export {
  assertSecureTransport,
  createRemoteFetch,
  fetchRemoteRoute,
  listProtocolRouteCandidates,
} from "./client-transport";
export type {
  RemoteClientRequestOptions,
  RemoteFetchInit,
} from "./client-transport";

// 健康检查
export { checkRemoteHealth } from "./client-health";

// 执行与 Action 查询
export {
  executeRemoteAction,
  fetchRemoteActionShow,
  fetchRemoteActions,
  fetchRemoteDoctor,
  fetchRemoteInfo,
} from "./client-actions";
export type { RemoteExecuteOptions, RemoteExecutionResult } from "./client-actions";

// Playbook 规程查询
export { fetchRemotePlaybookShow, fetchRemotePlaybooks } from "./client-playbooks";

// 运行记录管理
export {
  cancelRemoteRun,
  clearRemoteRuns,
  fetchRemoteRun,
  fetchRemoteRuns,
} from "./client-runs";

// 状态存储管理
export {
  clearRemoteState,
  deleteRemoteStateKey,
  fetchRemoteStateList,
  getRemoteStateKey,
  setRemoteStateKey,
} from "./client-state";

// 配置管理
export {
  deleteRemoteConfig,
  fetchRemoteConfig,
  fetchRemoteConfigEnv,
  setRemoteConfig,
} from "./client-config";
