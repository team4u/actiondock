/**
 * ActionDock 核心引擎公共 API 统一收口与出口定义。
 *
 * 遵循架构设计规范铁律：收窄为 Minimal 核心门面，非必要内部工程辅助函数、
 * 平台大对象驱动与解析器工具移至特定子路径导出（./server, ./project, ./registry,
 * ./profile, ./graph, ./package），严格杜绝在根导出泄露内部执行与平台上下文机制。
 */

// 1. 核心版本号单一事实源
export { ACTIONDOCK_VERSION } from "./version";

// 2. 统一服务门面与聚合契约接口
export {
  createActionDock,
  connectActionDock,
} from "./service/factory";
export type {
  ActionDockService,
  ActionDockService as ActionDock,
  DiscoveryPort,
  ExecutionPort,
  RunsPort,
  EventsPort,
  RunEventSubscriptionOptions,
  ConfigPort,
  StatePort,
  CreateActionDockOptions,
  ConnectActionDockOptions,
  RemoteServiceOptions,
  ConfigValueView,
  ListRunsOptions,
  StateScopeOptions,
} from "./service/types";

// 3. 执行配置与结果模型（转引 SDK 规范类型与核心执行契约）
export type {
  ActionRef,
  ResolvedActionRef,
  ExecutionResult,
  RunRecord,
  ExecutionEvent,
} from "@actiondock/sdk";
export type {
  RunOptions,
  ExecutionTicket,
  CancelResult,
} from "./execution/types";

// 4. 动作与包描述模型
export type {
  ActionSpec,
  ActionSummary,
  PlaybookSpec,
  PlaybookSummary,
  PackageInfo,
  ListActionsOptions,
} from "./package/types";

// 5. 原生平台装配与服务启动
export {
  createNodePlatform,
  type NodePlatformOptions,
} from "./platform/node";
export {
  startActionDockServer,
} from "./server/server";
export type {
  ServerOptions,
  ServerOptions as ActionDockServerOptions,
  ActionDockServerInstance,
} from "./server/types";

// 6. 核心工程辅助
export { initProject } from "./project/init";
export {
  loadProjectConfig,
  findProjectRoot,
} from "./project/loader";
export type {
  ProjectConfig,
} from "./project/types";

// 7. 包图抽象契约
export type {
  PackageGraph,
} from "./catalog/graph";

// 8. 统一错误模型与核心标准错误码常量
export {
  ActionDockError,
  ProcessError,
  type ErrorCode,
  PACKAGE_NOT_FOUND,
  ACTION_PACKAGE_VERSION_CONFLICT,
  ACTION_NOT_FOUND,
  ACTION_LOAD_FAILED,
  ACTION_FAILED,
  ACTION_TIMEOUT,
  ACTION_CANCELLED,
  INPUT_VALIDATION_FAILED,
  OUTPUT_VALIDATION_FAILED,
  INPUT_NOT_JSON,
  OUTPUT_NOT_JSON,
  ACTION_SUBRUN_LIMIT,
  ACTION_CALL_CYCLE,
  ACTION_CYCLE_DETECTED,
  MAX_SUBRUNS_REACHED,
  ACTION_MAX_DEPTH_EXCEEDED,
  UNDECLARED_ACTION_DEPENDENCY,
  INVALID_ACTION_REF,
  IDEMPOTENCY_CONFLICT,
  EXECUTION_FAILED,
  UNHANDLED_EXECUTION_ERROR,
  RUN_REPOSITORY_UNAVAILABLE,
  RUN_PERSISTENCE_FAILED,
  STANDALONE_ASYNC_UNSUPPORTED,
  INVOCATION_UNSUPPORTED,
  HOST_PROCESS_EXITED,
  EXECUTION_ABORTED,
  TIMEOUT,
  NETWORK_ERROR,
  REMOTE_STREAM_UNAVAILABLE,
  CAPABILITY_UNAVAILABLE,
  STATE_KEY_NOT_FOUND,
  STORAGE_BUSY,
  PROJECT_BUSY,
  PROJECT_RECOVERY_REQUIRED,
  STORAGE_WORKER_EXITED,
  EVENT_BACKPRESSURE_LIMIT,
  EVENT_CURSOR_EXPIRED,
  PROCESS_OUTPUT_LIMIT,
  PROCESS_SPAWN_ERROR,
  PROCESS_CANCELLED,
  PROCESS_TIMEOUT,
  UNAUTHORIZED,
  NOT_FOUND,
  SERVER_ERROR,
  BAD_REQUEST,
  PACKAGE_FORBIDDEN,
  PLAYBOOK_NOT_FOUND,
  REQUEST_TOO_LARGE,
  ACTION_START_FAILED,
  ACTION_EXECUTION_ERROR,
  ACTIONS_LIST_ERROR,
  PLAYBOOKS_LIST_ERROR,
  RUNS_LIST_ERROR,
  RUNS_CLEAR_ERROR,
  INFO_ERROR,
  PACKAGES_INFO_ERROR,
  DOCTOR_ERROR,
  RUN_INTERRUPTED,
  CONFIG_ENV_ERROR,
  CONFIG_LIST_ERROR,
  CONFIG_SET_ERROR,
  CONFIG_DELETE_ERROR,
  STATE_LIST_ERROR,
  STATE_CLEAR_ERROR,
  STATE_KEY_ERROR,
  DATA_DIR_IN_USE,
  DATA_DIR_RECOVERY_REQUIRED,
  UNSUPPORTED_STORAGE_SCHEMA,
  STORED_ERROR_DECODE_FAILED,
  PROCESS_FAILED,
  GENERATED_TYPES_OUTDATED,
  PROTOCOL_UNSUPPORTED,
  SERVICE_RESULT_UNKNOWN,
  MCP_TOOL_NAME_COLLISION,
  ACCESS_DENIED,
  UNSUPPORTED_CAPABILITY,
  CONTROL_BUSY,
  CONTROL_EXPIRED,
  CONTROL_REVOKED,
  PROCESS_QUARANTINED,
  PROCESS_LOST,
  REQUEST_CONFLICT,
  INPUT_OUTCOME_UNKNOWN,
  OUTPUT_GAP,
  OUTPUT_UNAVAILABLE,
  INVALID_CURSOR,
  QUEUE_FULL,
  QUOTA_EXCEEDED,
  INPUT_CLOSED,
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_LIMIT_EXCEEDED,
  INPUT_POLICY_VIOLATION,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
  INVALID_ARGUMENT,
  PACKAGE_NOT_ALLOWED,
  INVALID_PACKAGE_ID,
  PATH_TRAVERSAL,
  AMBIGUOUS_STATE_KEY,
  RUN_NOT_FOUND,
  RUN_ALREADY_FINISHED,
  IPC_ERROR,
} from "./errors";
