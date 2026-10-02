import { createHash } from "node:crypto";
import type { ProcessInfo } from "@actiondock/sdk";
import { ACCESS_DENIED, INPUT_VALIDATION_FAILED, ProcessError } from "../errors";
import type { ProcessOwnerFilter, StoredProcessRecord } from "./metadata-store";
import type { ProcessOwner } from "./managed-record";

/**
 * 格式化生成作用域唯一隔离字符串。
 */
export function formatProcessScope(owner: ProcessOwner): string {
  return `${owner.tenantId}:${owner.principalId}:${owner.packageInstanceId}:${owner.generationId}`;
}

/**
 * 校验调用方所有者凭据与目标记录是否完全匹配。
 */
export function checkOwnerAuthorized(
  owner: ProcessOwner,
  target: ProcessOwnerFilter | StoredProcessRecord
): void {
  if (
    !owner ||
    !owner.tenantId ||
    !owner.principalId ||
    !owner.packageInstanceId ||
    !owner.generationId
  ) {
    throw new ProcessError(ACCESS_DENIED, "Missing required owner identity fields");
  }

  if (
    owner.tenantId !== target.tenantId ||
    owner.principalId !== target.principalId ||
    owner.packageInstanceId !== target.packageInstanceId ||
    owner.generationId !== target.generationId
  ) {
    throw new ProcessError(ACCESS_DENIED, "Access denied: owner identity mismatch");
  }
}

/**
 * 计算任意 JSON 负载对象的 SHA-256 哈希值。
 */
export function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * 将持久化记录转换为 SDK 标准 ProcessInfo 快照。
 */
export function toSdkProcessInfo(record: StoredProcessRecord): ProcessInfo {
  const ctrl = (record.control ?? record.controlState ?? "free") as ProcessInfo["control"];
  const exitDetails =
    record.exitCode !== undefined || record.exitSignal !== undefined
      ? { code: record.exitCode ?? null, signal: record.exitSignal ?? null }
      : undefined;

  return {
    id: record.processId,
    hostEpoch: record.hostEpoch,
    state: record.state as any,
    control: ctrl,
    io: (record.ioConfig ?? { mode: "pipe" }) as any,
    capabilities: (record.capabilities ?? {
      pty: false,
      resize: false,
      inputEOF: false,
      interruptForeground: false,
      terminationScope: "process",
    }) as any,
    createdAt: record.createdAt ?? new Date().toISOString(),
    exit: exitDetails,
    endReason: record.endReason as any,
    outputClosed: Boolean(record.outputClosed),
    outputEndReason: record.outputEndReason as any,
    effectiveLimits: (record.effectiveLimits ?? {
      idleMs: 60000,
      lifetimeMs: 3600000,
      outputBufferBytes: 4 * 1024 * 1024,
    }) as any,
  };
}

/**
 * 将内部模型转换为持久化记录。
 */
export function toStoredProcessRecord(
  owner: ProcessOwner,
  info: ProcessInfo,
  startRequestId?: string
): StoredProcessRecord {
  return {
    processId: info.id,
    tenantId: owner.tenantId,
    principalId: owner.principalId,
    packageInstanceId: owner.packageInstanceId,
    generationId: owner.generationId,
    hostEpoch: info.hostEpoch,
    state: info.state,
    controlState: info.control,
    control: info.control,
    ioConfig: info.io as any,
    capabilities: info.capabilities as any,
    createdAt: info.createdAt,
    exitCode: info.exit ? info.exit.code : null,
    exitSignal: info.exit ? info.exit.signal : null,
    endReason: info.endReason ?? null,
    outputClosed: info.outputClosed,
    outputEndReason: info.outputEndReason ?? null,
    inputClosed: false,
    effectiveLimits: info.effectiveLimits as any,
    startRequestId,
  };
}

/**
 * 校验正整数毫秒时长参数，非法时抛出参数错误。
 */
export function checkPositiveDurationMs(value: number, field: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ProcessError(INPUT_VALIDATION_FAILED, `Invalid ${field}: must be a positive integer (milliseconds)`, {
      [field]: value,
    });
  }
}
