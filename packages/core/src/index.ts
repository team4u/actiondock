/**
 * ActionDock 核心引擎公共 API 统一收口与出口定义。
 *
 * 遵循架构设计规范铁律：内部模块默认不属于 public API，严格杜绝 export * 直接公开内部实现。
 * 仅显式导出稳定公共契约、服务端口、工程门面与必要适配层。
 */

// 1. 核心版本号单一事实源
export { ACTIONDOCK_VERSION } from "./version";

// 2. 统一服务门面与服务实现
export {
  createActionDock,
  connectActionDock,
} from "./service/factory";
export { LocalActionDockService } from "./service/local";
export { RemoteActionDockService } from "./service/remote";
export type {
  ActionDockService,
  ActionDockService as ActionDock,
  DiscoveryPort,
  ExecutionPort,
  RunsPort,
  ConfigPort,
  StatePort,
  CreateActionDockOptions,
  ConnectActionDockOptions,
} from "./service/types";

// 3. 核心服务端口与契约类型（转引 SDK 规范类型与应用层契约）
export type {
  ActionRef,
  ResolvedActionRef,
  ExecutionResult,
  RunRecord,
  ExecutionEvent,
} from "@actiondock/sdk";
export type {
  ActionSpec,
  ActionSummary,
  PlaybookSpec,
  PlaybookSummary,
  PackageInfo,
  ListActionsOptions,
} from "./app/types";
export type {
  RunOptions,
  ExecutionTicket,
  CancelResult,
  PackageIdentity,
  ActionInvoker,
  InvocationContext,
} from "./execution/types";
export { createPackageIdentity } from "./runtime/identity";
export { InvocationPolicy, type InvocationPolicyOptions } from "./invocation/policy";
export {
  DefaultExecutionService,
  DefaultExecutionService as ExecutionService,
  type ExecutionServiceOptions,
} from "./execution/service";

// 4. 平台与服务启动
export {
  createNodePlatform,
  type NodePlatformOptions,
} from "./platform/node";
export { NodeSqliteDriver } from "./storage/sqlite-driver";
export { NodeHttpServer } from "./server/http-server";
export { NodeFileSystem } from "./platform/node-fs";
export { NodeModuleLoader } from "./node/module-loader";
export { NodeProcessDriver } from "./process/process-driver";
export {
  startActionDockServer,
  launchHttpServer,
  formatHostForUrl,
} from "./server/server";
export type {
  ServerOptions as ActionDockServerOptions,
  ActionDockServerInstance,
  ServerTlsOptions,
} from "./server/types";
export {
  isLoopbackHost,
  resolveCorsHeaders,
  verifyBearerToken,
} from "./server/security";
export { DEFAULT_MAX_BODY_BYTES } from "./server/body";

// 5. 工程与配置
export { initProject } from "./project/init";
export {
  loadProjectConfig,
  findProjectRoot,
  getInstallCommand,
  loadActions,
  loadPlaybooks,
} from "./project/loader";
export {
  resolvePackageRoot,
  discoverProjects,
} from "./registry/registry";
export {
  loadManifest,
  saveManifest,
  validateManifest,
  MANIFEST_FILE_NAME,
  ACTION_ID_REGEX,
} from "./project/manifest";
export {
  computeManifestDigest,
  parseJsonWithoutDuplicates,
} from "./project/digest";
export {
  loadLockfile,
  saveLockfile,
  type ActionDockLockfile,
} from "./project/lockfile";
export {
  checkGeneratedTypes,
  writeActionTypes,
  GENERATED_TYPES_OUTDATED_CODE,
} from "./project/types-generator";
export type {
  ProjectConfig,
  ActionDockManifest,
  ActionManifestEntry,
  ConfigItemDefinition,
  PlaybookDefinition,
} from "./project/types";

// 6. 目录、发现与编排规程
export { resolveAction } from "./catalog/resolve-action";
export { resolvePlaybook } from "./catalog/resolve-playbook";
export {
  DefaultActionCatalog,
  type ActionCatalog,
} from "./catalog/action-catalog";
export { ActionResolver } from "./catalog/action-resolver";
export { PackageDiscovery } from "./catalog/discovery";
export { PackageGraphBuilder } from "./catalog/graph";
export { buildActionDescribePayload } from "./input/describe";
export { filterWithFallbackInfo } from "./filter/intent";

// 7. 注册表与软链接管理
export {
  linkPackage,
  unlinkPackage,
  listLinkedPackages,
  pruneRegistry,
  getRegistryStatus,
} from "./registry/registry";
export type { RegistryStatusReport } from "./registry/types";

// 8. 运行配置与目标管理
export {
  addProfile,
  removeProfile,
  updateProfile,
  useProfile,
  getProfile,
  listProfiles,
  loadProfiles,
  resolveProfileToken,
  resolveTarget,
} from "./profile/manager";
export { toSnakeUpperCase } from "./runtime/env";
export {
  fetchRemoteConfig,
  fetchRemoteConfigEnv,
} from "./profile/client-config";
export {
  fetchRemoteDoctor,
  fetchRemoteInfo,
} from "./profile/client-actions";
export {
  fetchRemotePlaybooks,
  fetchRemotePlaybookShow,
} from "./profile/client-playbooks";
export { checkRemoteHealth } from "./profile/client-health";
export { createActionDockTarget } from "./target/target";
export type {
  ActionDockTarget,
  RemoteTargetOptions,
  ConfigValueView,
  ListRunsOptions,
  StateScopeOptions,
} from "./target/types";
export type { ResolvedTarget } from "./profile/types";
export { ServiceActionDockTarget } from "./target/local";
export { IpcActionDockTarget } from "./ipc/target";

// 9. 统一错误模型与标准错误码
export {
  ActionDockError,
  ProcessError,
  type ErrorCode,
  describeActionLoadFailure,
  isMissingModuleError,
  type ActionLoadFailureContext,
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
} from "./errors";
export {
  InputError,
  FlatInputError,
} from "./input/flat-errors";
export {
  resolveActionInput,
  buildActionInputAdvice,
  formatActionDetail,
  mapInputValidationFailure,
  type ResolveActionInputOptions,
} from "./input/index";
export { validateActionInputValue } from "./json/value-validator";
export {
  parseJson,
  readStdin,
  stripBom,
} from "./input/input-resolver";

// 10. 运行时契约、时钟与存储
export type {
  RuntimePlatform,
  FileSystem,
  StorageFactory,
  StorageFactoryOptions,
  GlobalStorageFactoryOptions,
} from "./platform/types";
export {
  type Clock,
  SystemClock,
} from "./runtime/clock";
export type { ModuleLoader } from "./node/module-loader";
export {
  InMemoryEventSink,
  type EventSink,
} from "./runtime/events";
export {
  RuntimeConfig,
  RuntimeStateStore,
} from "./runtime/context";
export { normalizeActionCollection } from "./runtime/action-collection";

// 11. 进程管理契约
export {
  ProcessManager,
  type ProcessOwner,
} from "./process/process-manager";
export type { ProcessExecutor } from "./runtime/process";
export type {
  ProcessDriver,
  ProcessDriverCallbacks,
  ProcessDriverHandle,
  ProcessHandle,
  ProcessObserver,
} from "./process/driver";
export { findExecutable } from "./utils/index";

// 12. 宿主容器与单包应用适配层
export {
  createActionDockHost,
  DefaultActionDockHost,
} from "./host/host";
export type {
  ActionDockHost,
  ActionDockHostOptions,
} from "./host/types";
export {
  ActionPackageResolver,
  type ActionPackageResolverOptions,
} from "./project/resolver";
export {
  createActionDockApp,
  DefaultActionDockApp,
} from "./app/app";
export type {
  ActionDockApp,
  ActionDockAppOptions,
} from "./app/types";

// 13. IPC 通信与单执行分发器
export { serveParentIpc } from "./ipc/host";
export {
  ExitCode,
  StandaloneDispatcher,
  type StandaloneDispatcherOptions,
  type InvocationControl,
} from "./runtime/standalone";

// 14. 存储引擎与状态存取
export {
  createStorage,
  resolveDatabasePath,
} from "./storage/index";
export { SqliteRuntimeStorage } from "./storage/sqlite";
export { beginTransaction } from "./project/transactions";
export type {
  RuntimeStorage,
  SqliteDriver,
} from "./storage/types";
export { decodeStateKey } from "./storage/sqlite";
export {
  isSecretConfigKey,
  maskSecretValue,
} from "./storage/mask";

// 15. 体检工具与通用文件路径工具
export { runDoctorChecks } from "./doctor/doctor";
export {
  getActionDockHome,
  getPackageSlug,
  assertPathWithinRoot,
  isPathOutsideBoundary,
  parseDuration,
} from "./utils/index";
export { resolveEnvValue } from "./runtime/env";
