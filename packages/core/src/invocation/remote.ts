import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ActionContract, ActionRef, Logger, RunRecord } from "@actiondock/sdk";
import {
  ActionDockError,
  ACTION_CANCELLED,
  EXECUTION_FAILED,
  INVALID_ARGUMENT,
  NETWORK_ERROR,
  SERVICE_CLOSED,
  SERVICE_RESULT_UNKNOWN,
  TIMEOUT,
  type ErrorCode,
} from "../errors";
import { parseActionRef } from "../catalog/resolve-action";
import { RemoteActionDockService } from "../service/remote";
import type { ActionSpec } from "../package/types";
import type { RemoteServiceOptions, RunOptions } from "../service/types";
import type { ExecutionTicket } from "../execution/types";
import type { ExecutionResult } from "@actiondock/sdk";
import type { InvocationContext } from "./types";

/**
 * 远端调用绑定与 Profile 元信息。
 */
export interface RemoteInvocationMetadata {
  /** 宿主绑定的逻辑标识 */
  binding: string;
  /** 目标 Profile 标识 */
  profile: string;
}

/**
 * 清理、反查与发现默认有界等待时限（毫秒）。
 */
const DEFAULT_CLEANUP_TIMEOUT_MS = 5000;
const DEFAULT_LOOKUP_TIMEOUT_MS = 3000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10000;

/**
 * 过滤 URL 中携带的用户、密码凭据与敏感查询参数，防止泄漏至日志或异常元数据。
 */
function sanitizeServerUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    parsed.username = "";
    parsed.password = "";
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", "[REDACTED]");
    }
    return parsed.origin;
  } catch {
    return "[invalid-url]";
  }
}

/**
 * 脱敏字符串中的敏感 Token 与 URL 凭据。
 */
function sanitizeString(str: string, token?: string): string {
  let result = str;
  if (token && token.length > 0) {
    result = result.replaceAll(token, "[REDACTED]");
  }
  // 脱敏 URL 用户密码凭据 (http://user:pass@host)
  result = result.replace(/(https?:\/\/)([^/@\s]+)@/g, "$1[REDACTED]@");
  // 脱敏查询参数中的 token / key / secret / password
  result = result.replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
  return result;
}

/**
 * 格式化脱敏错误信息。
 */
function sanitizeErrorMessage(msg?: unknown, token?: string): string {
  if (typeof msg !== "string") {
    return "";
  }
  return sanitizeString(msg, token);
}

/**
 * 深度脱敏错误元数据与原始对象，防止 Token 与 URL 凭据泄漏。
 */
function sanitizeDetails<T>(val: T, token?: string): T {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === "string") {
    return sanitizeString(val, token) as unknown as T;
  }
  if (val instanceof Error) {
    return sanitizeString(val.message, token) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeDetails(item, token)) as unknown as T;
  }
  if (typeof val === "object") {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (
        k.toLowerCase().includes("token") ||
        k.toLowerCase().includes("secret") ||
        k.toLowerCase().includes("password")
      ) {
        sanitizedObj[k] = "[REDACTED]";
      } else {
        sanitizedObj[k] = sanitizeDetails(v, token);
      }
    }
    return sanitizedObj as T;
  }
  return val;
}

/**
 * 构造统一且剔除敏感凭据的错误详情信封。
 */
function buildErrorDetails(
  action: string,
  metadata: RemoteInvocationMetadata,
  requestId: string,
  resultUnknown: boolean,
  remoteRunId?: string,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    action,
    binding: metadata.binding,
    profile: metadata.profile,
    requestId,
    remoteRunId,
    resultUnknown,
    ...extra,
  };
}

/**
 * 反查运行记录返回结果结构。
 */
interface QueryRunResult {
  record?: RunRecord;
  error?: any;
}

/**
 * 针对指定唯一 requestId 执行有界反查。
 */
async function queryRunByRequestId(
  service: RemoteActionDockService,
  requestId: string,
  timeoutMs: number
): Promise<QueryRunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const runs = await service.runs.list(
      { requestIds: [requestId], limit: 1 },
      { signal: controller.signal }
    );
    return { record: runs && runs.length > 0 ? runs[0] : undefined };
  } catch (err: any) {
    return { error: err };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 远端任务有界取消调用结果结构。
 */
interface CancelExecutionResult {
  ok: boolean;
  outcome?: "requested" | "already_terminal" | "not_found" | "not_owner";
  resultUnknown: boolean;
  error?: any;
}

/**
 * 针对远端任务执行有界取消调用，避免无限阻塞与定时器泄漏。
 */
async function cancelRunWithBoundedTimeout(
  service: RemoteActionDockService,
  runId: string,
  timeoutMs: number
): Promise<CancelExecutionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      service.runs.cancel(runId, "Parent invocation cancelled"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Cancellation timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);

    if (res.outcome === "not_found" || res.outcome === "not_owner") {
      return {
        ok: false,
        outcome: res.outcome,
        resultUnknown: true,
        error: new Error(`Cancellation failed with outcome: ${res.outcome}`),
      };
    }

    if (res.outcome === "already_terminal") {
      return {
        ok: true,
        outcome: "already_terminal",
        resultUnknown: false,
      };
    }

    // res.outcome === "requested"
    // requested 仅表示已请求，不可宣称终态已停止，resultUnknown 要诚实
    return {
      ok: true,
      outcome: "requested",
      resultUnknown: true,
    };
  } catch (err: any) {
    return {
      ok: false,
      resultUnknown: true,
      error: err,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** 等待必须响应调用方取消，不能依赖服务实现主动结束结果 Promise。 */
function waitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Invocation cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Invocation cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

/**
 * 安全的远端嵌套调用适配执行器。
 *
 * 遵循原则：
 * - 目标 target 由 Host 预先根据 profile 解析并冻结传入，不自作路由决断。
 * - 连接缓存按 target 对象身份隔离复用，并在 close() 时全量释放。
 * - 严格防范凭证与本地私有上下文泄漏，仅透传必要控制字段。
 * - 取消与清理全链路有界且透传远端 runs.cancel，严禁静默吞没未确认终态。
 */
export class RemoteInvocationExecutor {
  private readonly logger?: Logger;
  private readonly services = new Map<RemoteServiceOptions, RemoteActionDockService>();
  private isClosed = false;
  private readonly closeController = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(options?: { logger?: Logger }) {
    this.logger = options?.logger;
  }

  /**
   * 触发执行远端 Action 动作。
   */
  public invoke(
    target: RemoteServiceOptions,
    ref: ActionRef | string,
    input: unknown,
    context: InvocationContext,
    metadata: RemoteInvocationMetadata,
    expectedContract?: ActionContract
  ): Promise<unknown> {
    const operation = this.execute(target, ref, input, {
      ...context,
      signal: AbortSignal.any([context.signal, this.closeController.signal]),
    }, metadata, expectedContract);
    this.pending.add(operation);
    const settled = () => { this.pending.delete(operation); };
    operation.then(settled, settled);
    return operation;
  }

  private async execute(
    target: RemoteServiceOptions,
    ref: ActionRef | string,
    input: unknown,
    context: InvocationContext,
    metadata: RemoteInvocationMetadata,
    expectedContract?: ActionContract
  ): Promise<unknown> {
    const childRequestId = randomUUID();
    let parsedRef: ActionRef;
    try {
      parsedRef = parseActionRef(ref);
    } catch {
      parsedRef = typeof ref === "object" && ref !== null ? ref : { actionId: String(ref) };
    }
    const actionStr = parsedRef.packageId
      ? `${parsedRef.packageId}/${parsedRef.actionId}`
      : parsedRef.actionId;

    const logger = context.logger ?? this.logger;
    const sanitizedTarget = sanitizeServerUrl(target.serverUrl);

    const makeDetails = (resultUnknown: boolean, remoteRunId?: string, extra?: Record<string, unknown>) =>
      buildErrorDetails(actionStr, metadata, childRequestId, resultUnknown, remoteRunId, extra);

    // 1. 检查执行器生命周期状态
    if (this.isClosed) {
      const err = new ActionDockError(
        SERVICE_CLOSED,
        "RemoteInvocationExecutor is closed",
        makeDetails(false, undefined)
      );
      logger?.error?.(
        `[RemoteInvocation] Executor closed: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}`
      );
      throw err;
    }

    // 2. 检查前置取消信号，阻止任何网络通信
    if (context.signal.aborted) {
      const err = new ActionDockError(
        ACTION_CANCELLED,
        "Action execution was cancelled before start",
        makeDetails(false, undefined)
      );
      logger?.warn?.(
        `[RemoteInvocation] Pre-cancelled: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}`
      );
      throw err;
    }

    // 3. 复用或建立 target 对应的远端服务连接
    let service = this.services.get(target);
    if (!service) {
      if (this.isClosed) {
        throw new ActionDockError(
          SERVICE_CLOSED,
          "RemoteInvocationExecutor is closed",
          makeDetails(false, undefined)
        );
      }
      service = new RemoteActionDockService(target);
      this.services.set(target, service);
    }

    // 4. 远端契约发现与校验（使用有界 / AbortSignal race 确保响应父级取消，避免无限等待或取消后仍继续执行）
    let remoteSpec: ActionSpec;
    const discoveryTimeoutMs = Math.min(
      DEFAULT_DISCOVERY_TIMEOUT_MS,
      Math.max(1000, context.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS)
    );
    try {
      if (context.signal.aborted) {
        throw new ActionDockError(
          ACTION_CANCELLED,
          "Action execution was cancelled before discovery",
          makeDetails(false, undefined)
        );
      }

      let abortListener: (() => void) | undefined;
      let discoveryTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        remoteSpec = await Promise.race([
          service.discovery.describeAction(ref),
          new Promise<never>((_, reject) => {
            abortListener = () => {
              reject(
                new ActionDockError(
                  ACTION_CANCELLED,
                  "Action execution was cancelled during discovery",
                  makeDetails(false, undefined)
                )
              );
            };
            context.signal.addEventListener("abort", abortListener, { once: true });
            discoveryTimer = setTimeout(() => {
              reject(
                new ActionDockError(
                  NETWORK_ERROR,
                  `Discovery timed out after ${discoveryTimeoutMs}ms for action '${actionStr}'`,
                  makeDetails(false, undefined)
                )
              );
            }, discoveryTimeoutMs);
          }),
        ]);
      } finally {
        if (discoveryTimer !== undefined) {
          clearTimeout(discoveryTimer);
        }
        if (abortListener !== undefined) {
          context.signal.removeEventListener("abort", abortListener);
        }
      }
    } catch (err: any) {
      if (context.signal.aborted) {
        throw new ActionDockError(
          ACTION_CANCELLED,
          "Action execution was cancelled during discovery",
          makeDetails(false, undefined)
        );
      }
      const code = err?.code || NETWORK_ERROR;
      const sanitizedMsg = sanitizeErrorMessage(err?.message, target.token);
      const wrappedErr = new ActionDockError(
        code,
        `Failed to describe remote action '${actionStr}': ${sanitizedMsg}`,
        makeDetails(false, undefined, {
          originalError: sanitizeDetails(err?.details ?? err?.message, target.token),
        })
      );
      logger?.error?.(
        `[RemoteInvocation] Discovery failed: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, error=${sanitizedMsg}`
      );
      throw wrappedErr;
    }

    if (expectedContract) {
      const expectedInput = expectedContract.inputSchema ?? {};
      const actualInput = remoteSpec.inputSchema ?? {};
      const expectedOutput = expectedContract.outputSchema ?? {};
      const actualOutput = remoteSpec.outputSchema ?? {};

      if (!isDeepStrictEqual(expectedInput, actualInput) || !isDeepStrictEqual(expectedOutput, actualOutput)) {
        const err = new ActionDockError(
          INVALID_ARGUMENT,
          `Remote action contract schema mismatch for action '${actionStr}'`,
          makeDetails(false, undefined, {
            expectedInput,
            actualInput,
            expectedOutput,
            actualOutput,
          })
        );
        logger?.error?.(
          `[RemoteInvocation] Contract schema mismatch: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}`
        );
        throw err;
      }
    }

    // 5. 校验通过，准备发起远端异步执行
    if (context.signal.aborted) {
      throw new ActionDockError(
        ACTION_CANCELLED,
        "Action execution was cancelled before start",
        makeDetails(false, undefined)
      );
    }

    const cleanupTimeoutMs = Math.min(
      DEFAULT_CLEANUP_TIMEOUT_MS,
      Math.max(1000, context.timeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS)
    );
    const lookupTimeoutMs = Math.min(
      DEFAULT_LOOKUP_TIMEOUT_MS,
      Math.max(1000, context.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS)
    );

    const startOptions: RunOptions = {
      timeoutMs: context.timeoutMs,
      requestId: childRequestId,
      signal: context.signal,
    };

    let ticket: ExecutionTicket | undefined;
    let startError: any;

    try {
      ticket = await service.execution.start(ref, input, startOptions);
    } catch (err: any) {
      startError = err;
    }

    // 检查 ticket 是否代表确定性拒绝（如鉴权失败、入参校验失败等）：
    // execution.start 可能返回 { status: 'failed', runId: '', result: Promise.resolve({ ok: false, error: ... }) }
    // 必须先读取 failed ticket 保留确定拒绝 code，不能误判为 SERVICE_RESULT_UNKNOWN。
    if (ticket && (ticket.status === "failed" || !ticket.runId)) {
      if (ticket.result) {
        try {
          const res = await ticket.result;
          if (res && !res.ok && res.error) {
            const errCode = res.error.code;
            const isTransportUnknown =
              errCode === NETWORK_ERROR ||
              errCode === "ACTION_TIMEOUT" ||
              errCode === "TIMEOUT" ||
              errCode === ACTION_CANCELLED;

            if (!isTransportUnknown) {
              const sanitizedErrMsg =
                sanitizeErrorMessage(res.error.message, target.token) || "Remote execution rejected";
              logger?.warn?.(
                `[RemoteInvocation] Remote start rejected deterministically: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, code=${errCode}, error=${sanitizedErrMsg}`
              );
              throw new ActionDockError(
                (errCode as ErrorCode) || EXECUTION_FAILED,
                sanitizedErrMsg,
                makeDetails(false, undefined, {
                  remoteError: sanitizeDetails(res.error.details ?? res.error, target.token),
                })
              );
            }
          }
        } catch (readErr: any) {
          if (readErr instanceof ActionDockError) {
            throw readErr;
          }
          startError = readErr;
        }
      }
      if (!ticket.runId) {
        ticket = undefined;
      }
    }

    // 6. 接受前中断处理（远端可能已受理执行，进行有界反查与补发取消）
    if (!ticket || !ticket.runId) {
      const lookupRes = await queryRunByRequestId(service, childRequestId, lookupTimeoutMs);
      const foundRun = lookupRes.record;

      if (foundRun) {
        // 使用 RunRecord 的唯一标识 id（不可使用 runId）
        const cancelRes = await cancelRunWithBoundedTimeout(service, foundRun.id, cleanupTimeoutMs);
        if (!cancelRes.ok) {
          const sanitizedCancelMsg = sanitizeErrorMessage(cancelRes.error?.message, target.token);
          logger?.error?.(
            `[RemoteInvocation] Cancel cleanup failed for accepted run '${foundRun.id}': ${sanitizedCancelMsg}`
          );
          throw new ActionDockError(
            SERVICE_RESULT_UNKNOWN,
            `Interrupted before acceptance, and cancel cleanup failed for run '${foundRun.id}': ${sanitizedCancelMsg}`,
            makeDetails(true, foundRun.id, {
              cancelOutcome: cancelRes.outcome,
              originalError: sanitizedCancelMsg,
            })
          );
        }

        if (context.signal.aborted) {
          throw new ActionDockError(
            ACTION_CANCELLED,
            "Action execution was cancelled",
            makeDetails(cancelRes.resultUnknown, foundRun.id, {
              cancelOutcome: cancelRes.outcome,
            })
          );
        }

        const sanitizedStartMsg = sanitizeErrorMessage(startError?.message, target.token);
        throw new ActionDockError(
          SERVICE_RESULT_UNKNOWN,
          `Action execution was interrupted before acceptance and cancelled on remote: ${sanitizedStartMsg}`,
          makeDetails(cancelRes.resultUnknown, foundRun.id, {
            cancelOutcome: cancelRes.outcome,
            originalError: sanitizedStartMsg,
          })
        );
      }

      // 反查若发生错误，必须提供可观测错误元信息，不可宣称无记录
      if (lookupRes.error) {
        const sanitizedLookupMsg = sanitizeErrorMessage(lookupRes.error?.message, target.token);
        const sanitizedStartMsg = sanitizeErrorMessage(startError?.message, target.token);
        logger?.warn?.(
          `[RemoteInvocation] Interrupted before acceptance and run lookup failed: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, lookupError=${sanitizedLookupMsg}`
        );
        throw new ActionDockError(
          SERVICE_RESULT_UNKNOWN,
          `Action execution interrupted before acceptance; query run by requestId failed: ${sanitizedLookupMsg}`,
          makeDetails(true, undefined, {
            lookupError: sanitizedLookupMsg,
            originalError: sanitizedStartMsg,
          })
        );
      }

      // 反查成功但无记录：未能确认终态应使用 SERVICE_RESULT_UNKNOWN
      const sanitizedStartMsg = sanitizeErrorMessage(startError?.message, target.token);
      logger?.warn?.(
        `[RemoteInvocation] Interrupted before acceptance with unknown remote status: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}`
      );
      throw new ActionDockError(
        SERVICE_RESULT_UNKNOWN,
        `Action execution interrupted before acceptance; remote execution status is unknown: ${sanitizedStartMsg}`,
        makeDetails(true, undefined, {
          lookupRecordFound: false,
          originalError: sanitizedStartMsg,
        })
      );
    }

    // 7. 远端已成功接受调用并返回 runId
    const remoteRunId = ticket.runId;
    logger?.info(
      `[RemoteInvocation] Accepted: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}`
    );

    // 显式检查 ticket.result 是否存在，缺失应抛出 EXECUTION_FAILED 且不可触发 TypeError
    if (!ticket.result) {
      const err = new ActionDockError(
        EXECUTION_FAILED,
        `Execution ticket missing result Promise for remote run '${remoteRunId}'`,
        makeDetails(true, remoteRunId)
      );
      logger?.error?.(
        `[RemoteInvocation] Missing ticket.result: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}`
      );
      throw err;
    }

    // 防止未处理的 Promise Rejection
    ticket.result.catch(() => {});

    let cancelPromise: Promise<CancelExecutionResult> | undefined;
    const abortHandler = () => {
      cancelPromise = cancelRunWithBoundedTimeout(service!, remoteRunId, cleanupTimeoutMs);
    };

    if (context.signal.aborted) {
      abortHandler();
    } else {
      context.signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      let execResult: ExecutionResult;
      try {
        execResult = await waitWithSignal(ticket.result, context.signal);
      } catch (waitErr: any) {
        if (context.signal.aborted) {
          const cancelRes = await (cancelPromise ?? cancelRunWithBoundedTimeout(service, remoteRunId, cleanupTimeoutMs));
          if (!cancelRes.ok) {
            const sanitizedCancelMsg = sanitizeErrorMessage(cancelRes.error?.message, target.token);
            logger?.error?.(
              `[RemoteInvocation] Cancellation cleanup failed: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}, error=${sanitizedCancelMsg}`
            );
            throw new ActionDockError(
              SERVICE_RESULT_UNKNOWN,
              `Cancellation cleanup failed: ${sanitizedCancelMsg}`,
              makeDetails(true, remoteRunId, { cancelOutcome: cancelRes.outcome })
            );
          }
          throw new ActionDockError(
            ACTION_CANCELLED,
            "Action execution was cancelled",
            makeDetails(cancelRes.resultUnknown, remoteRunId, { cancelOutcome: cancelRes.outcome })
          );
        }

        const sanitizedWaitMsg = sanitizeErrorMessage(waitErr?.message, target.token);
        logger?.error?.(
          `[RemoteInvocation] Network failure while waiting: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}, error=${sanitizedWaitMsg}`
        );
        throw new ActionDockError(
          SERVICE_RESULT_UNKNOWN,
          `Communication lost while waiting for remote run '${remoteRunId}': ${sanitizedWaitMsg}`,
          makeDetails(true, remoteRunId, { originalError: sanitizedWaitMsg })
        );
      }

      // 若在此期间已被信号取消，必须等待远端 runs.cancel 发送完成
      if (context.signal.aborted) {
        const cancelRes = await (cancelPromise ?? cancelRunWithBoundedTimeout(service, remoteRunId, cleanupTimeoutMs));
        if (!cancelRes.ok) {
          const sanitizedCancelMsg = sanitizeErrorMessage(cancelRes.error?.message, target.token);
          logger?.error?.(
            `[RemoteInvocation] Cancellation cleanup failed: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}, error=${sanitizedCancelMsg}`
          );
          throw new ActionDockError(
            SERVICE_RESULT_UNKNOWN,
            `Cancellation cleanup failed: ${sanitizedCancelMsg}`,
            makeDetails(true, remoteRunId, { cancelOutcome: cancelRes.outcome })
          );
        }
        logger?.info?.(
          `[RemoteInvocation] Cancellation requested: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}`
        );
        throw new ActionDockError(
          ACTION_CANCELLED,
          "Action execution was cancelled",
          makeDetails(cancelRes.resultUnknown, remoteRunId, { cancelOutcome: cancelRes.outcome })
        );
      }

      if (execResult.ok) {
        logger?.info?.(
          `[RemoteInvocation] Succeeded: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}, target=${sanitizedTarget}`
        );
        return execResult.data;
      }

      // 执行终态失败分支
      const errCode = execResult.error?.code;
      const rawErrMsg = execResult.error?.message || "Remote action execution failed";
      const sanitizedErrMsg = sanitizeErrorMessage(rawErrMsg, target.token);

      if (errCode === NETWORK_ERROR || errCode === TIMEOUT || errCode === SERVICE_RESULT_UNKNOWN) {
        logger?.error?.(
          `[RemoteInvocation] Network error during execution wait: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}`
        );
        throw new ActionDockError(
          SERVICE_RESULT_UNKNOWN,
          `Network error while waiting for remote run '${remoteRunId}': ${sanitizedErrMsg}`,
          makeDetails(true, remoteRunId, {
            remoteError: sanitizeDetails(execResult.error, target.token),
          })
        );
      }

      if (errCode === SERVICE_CLOSED) {
        throw new ActionDockError(
          SERVICE_CLOSED,
          `Remote service closed: ${sanitizedErrMsg}`,
          makeDetails(true, remoteRunId)
        );
      }

      // 确定业务失败：保留原错误码
      logger?.warn?.(
        `[RemoteInvocation] Business error: action=${actionStr}, binding=${metadata.binding}, profile=${metadata.profile}, requestId=${childRequestId}, remoteRunId=${remoteRunId}, code=${errCode}`
      );
      throw new ActionDockError(
        (errCode as ErrorCode) || "ACTION_FAILED",
        sanitizedErrMsg,
        makeDetails(false, remoteRunId, {
          remoteError: sanitizeDetails(execResult.error?.details ?? execResult.error, target.token),
        })
      );
    } finally {
      context.signal.removeEventListener("abort", abortHandler);
    }
  }

  /**
   * 关闭所有持有的远端服务连接并释放关联资源，对外拒绝后续调用。
   */
  public async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.closeController.abort(new ActionDockError(SERVICE_CLOSED, "Remote invocation executor is closing"));
    // 先让在途调用完成有界反查与协作取消，再关闭其依赖的服务连接。
    await Promise.allSettled(Array.from(this.pending));
    const servicesToClose = Array.from(this.services.values());
    this.services.clear();
    await Promise.all(servicesToClose.map((s) => s.close()));
  }
}
