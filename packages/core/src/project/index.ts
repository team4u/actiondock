export * from "./closure";
export * from "./digest";
export * from "./init";
export * from "./loader";
export * from "./lockfile";
export * from "./manifest";
export {
  SNAPSHOT_TRACKED_FILES,
  type TransactionFileRecord,
  type TransactionMetadata,
  type ProjectTransaction,
  isPidAlive,
  isProjectLockHeld,
  acquireProjectLock,
  runFrozenInstall,
  hasPendingTransactions,
  beginTransaction,
  recoverPendingTransactions,
} from "./transactions";
export * from "./types";
export * from "./types-generator";
export {
  assertPathWithinRoot,
  isPathOutsideBoundary,
  getPackageSlug,
  parseDuration,
  traverseDirectory,
  type TraverseDirectoryEntry,
  type TraverseDirectoryOptions,
} from "../utils";
export {
  isSecretConfigKey,
  maskSecretValue,
  sanitizeConfigDefinitions,
} from "../storage/mask";
export {
  runDoctorChecks,
} from "../doctor/doctor";

// 动作入参解析、校验与格式化
export {
  resolveActionInput,
  buildActionInputAdvice,
  formatActionDetail,
  buildActionDescribePayload,
  mapInputValidationFailure,
  type ResolveActionInputOptions,
} from "../input/index";
export { validateActionInputValue } from "../json/value-validator";
export { parseJson } from "../input/input-resolver";
export {
  InputError,
  FlatInputError,
} from "../input/flat-errors";

// 意图过滤与查询
export {
  filterWithFallbackInfo,
  compileIntentRegex,
  matchIntent,
  type Extractor,
} from "../filter/intent";
