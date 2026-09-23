/**
 * 远端运行轮询兜底。
 *
 * 职责单一：SSE 事件流不可用或超时预算仍有剩余时，按指数退避轮询远端
 * 运行详情直至终态、取消或超时上限；并将终态运行记录翻译为统一
 * ExecutionResult 结构。不感知 SSE 通道与门面生命周期。
 */

import type { ExecutionResult, RunRecord } from "@actiondock/sdk";
import { ACTION_CANCELLED, EXECUTION_FAILED, RUN_INTERRUPTED, TIMEOUT } from "../errors";
import { isTerminalRunStatus } from "../storage/types";
import { SERVICE_CLOSED } from "./types";

/**
 * 轮询依赖上下文：由 RemoteActionDockService 门面注入自身能力，
 * 保持本模块与门面实现解耦。
 */
export interface RunPollingContext {
  /** 轮询等待基准底线超时时间（毫秒，默认 60000ms） */
  baseTimeoutMs: number;
  /** 目标是否已关闭 */
  isClosed(): boolean;
  /** 查询远端运行详情（键不存在时返回 undefined） */
  getRun(runId: string): Promise<RunRecord | undefined>;
}

/**
 * 将终态运行记录翻译为统一 ExecutionResult 结构。
 */
export function formatTerminalRunResult(run: RunRecord, runId: string): ExecutionResult {
  if (run.status === "success") {
    return { ok: true, runId, data: run.output ?? null };
  }
  if (run.status === "interrupted") {
    return {
      ok: false,
      runId,
      error: run.error || {
        code: RUN_INTERRUPTED,
        message: `Run '${runId}' was interrupted`,
      },
    };
  }
  return {
    ok: false,
    runId,
    error: run.error || {
      code: EXECUTION_FAILED,
      message: `Run finished with status ${run.status}`,
    },
  };
}

/**
 * 指数退避轮询远端运行详情直至终态、取消或超时上限。
 *
 * @param ctx 门面注入的依赖上下文
 * @param runId 运行标识
 * @param signal 外部取消信号
 * @param timeoutMs 运行自身声明的超时（未提供总上限时参与计算等待上限）
 * @param startTime 等待起点时间戳（缺省当前时间）
 * @param totalMaxWaitMs 已消耗等待预算对应的总上限（SSE 阶段已等待时传入）
 */
export async function pollRunCompletion(
  ctx: RunPollingContext,
  runId: string,
  signal?: AbortSignal,
  timeoutMs?: number,
  startTime: number = Date.now(),
  totalMaxWaitMs?: number
): Promise<ExecutionResult> {
  const maxWaitMs = totalMaxWaitMs ?? Math.max(ctx.baseTimeoutMs, timeoutMs ?? 0);
  const remainingWaitMs = Math.max(0, maxWaitMs - (Date.now() - startTime));
  let delayMs = Math.min(150, Math.max(10, Math.floor((remainingWaitMs || maxWaitMs) / 4)));
  const maxDelayMs = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    if (ctx.isClosed()) {
      return {
        ok: false,
        runId,
        error: {
          code: SERVICE_CLOSED,
          message: "RemoteActionDockService is closed",
        },
      };
    }
    if (signal?.aborted) {
      return {
        ok: false,
        runId,
        error: {
          code: ACTION_CANCELLED,
          message: "Action execution was cancelled",
        },
      };
    }
    try {
      const run = await ctx.getRun(runId);
      if (run && isTerminalRunStatus(run.status)) {
        return formatTerminalRunResult(run, runId);
      }
    } catch (err: any) {
      if (err?.code === SERVICE_CLOSED || ctx.isClosed()) {
        return {
          ok: false,
          runId,
          error: {
            code: SERVICE_CLOSED,
            message: "RemoteActionDockService is closed",
          },
        };
      }
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }

  const waitedMs = Date.now() - startTime;
  return {
    ok: false,
    runId,
    error: {
      code: TIMEOUT,
      message: `Timed out waiting for run '${runId}' completion after ${waitedMs}ms`,
    },
  };
}
