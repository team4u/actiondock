import {
  isRunHostDead,
  isTerminalRunStatus,
  type ActionDockService,
  type RunRecord,
} from "@actiondock/core";
import { ExecutionError } from "../errors";
import { writeStderr } from "../renderer";
import type { CliContext } from "../types";

/**
 * runs watch 轮询等待引擎。
 *
 * 职责单一：对指定执行环境服务的一组运行标识执行统一轮询循环，
 * 逐轮查询未终态记录直至全部终态、超时、外部中断或宿主丢失；聚合输出与退出判定由调用方消费。
 *
 * 架构决策与原则权衡（关于「事件驱动协作」）：
 * ActionDock 核心工程原则倡导事件驱动协作，但在 CLI 运行观察场景中采用只读轮询机制，
 * 是基于客观物理与系统边界约束推导的理性权衡：
 * - 进程边界与底层存储物理约束：CLI 作为独立的短暂只读旁观进程直接连接本地 SQLite 存储文件，
 *   任务宿主进程与 CLI 旁观进程分属完全独立的操作系统进程，SQLite 单文件存储层缺乏跨进程事件推送能力；
 * - 零守护进程哲学：ActionDock 坚持零守护进程（daemonless）本地轻量执行，不强制依赖常驻后台中继服务或事件服务器；
 * - 物理与架构最优解：在上述边界条件下，采用轻量只读、带瞬态错误容忍与自愈能力的定时轮询，
 *   是兼顾零常驻开销、环境免侵入与跨平台确定性的物理与架构最优解。
 *
 * 设计契约：
 * - 只读旁观：仅调用 service.runs.get，不取消任务、不收割运行记录、不写任何状态；
 * - 单一执行环境：一次 watch 绑定单一 Service 实例（本地或远端），不存在跨环境混合轮询；
 * - 瞬态容错：非中止查询异常在未达连续失败阈值前支持自愈，仅连续达到阈值时收敛为观察失败；
 * - 防御与透明：查询失败或宿主丢失不臆断任务到达终态，保留当前真实状态与观察错误，结束原因明确区分。
 */

/** 单个运行的归属解析结果。 */
export interface WatchRunSource {
  /** 运行标识 */
  runId: string;
  /** 归属类型：本地运行库或远端服务 */
  source: "local" | "remote";
  /** 归属解析阶段已取到的记录（若解析时已读到） */
  initialRecord?: RunRecord;
  /** 幂等请求标识（--request-id 反查路径携带，便于结果对因） */
  requestId?: string;
}

/** 单个运行的聚合输出条目。 */
export interface WatchRunOutcome {
  /** 运行标识 */
  runId: string;
  /** 归属类型 */
  source: "local" | "remote";
  /** 幂等请求标识（--request-id 反查路径携带） */
  requestId?: string;
  /** 最终状态：终态时为具体终态；超时中断或观察失败时为当时的最新状态 */
  status: string;
  /** 执行成功时的输出结果快照（取自运行记录的 output 字段） */
  data?: unknown;
  /** 执行失败或查询观察异常信息 */
  error?: unknown;
  /** 观察异常信息（若存在） */
  queryError?: unknown;
  /** 是否到达终态（严格仅由任务状态推导，查询失败或宿主死亡不得置 true） */
  terminal: boolean;
  /** 运行耗时（毫秒，取自运行记录；无记录时为 undefined） */
  durationMs?: number;
}

/** 整体等待结束原因。 */
export type WatchEndReason =
  | "all_terminal"
  | "timeout"
  | "interrupted"
  | "observation_failed";

/** 聚合等待结果。 */
export interface WatchAggregation {
  /** 是否全部到达终态且全部执行成功 */
  ok: boolean;
  /** 是否因整体超时提前结束 */
  timedOut: boolean;
  /** 是否因外部中断信号提前结束 */
  interrupted: boolean;
  /** 整体等待结束原因：全部终态、超时、中断或观察失败 */
  reason: WatchEndReason;
  /** 逐运行结果（保持用户输入顺序与 runId 去重） */
  runs: WatchRunOutcome[];
}

/** 轮询引擎依赖注入上下文。 */
export interface WatchPollContext {
  /** 目标执行环境服务端口实例（本地或远端） */
  service?: ActionDockService;
  /** 轮询间隔毫秒 */
  intervalMs: number;
  /** 相对超时毫秒（未指定为无限等待） */
  timeoutMs?: number;
  /** 统一绝对截止时间毫秒（从命令入口开始计算） */
  deadline?: number;
  /** 最大连续查询错误容忍阈值（未指定使用默认值 MAX_CONSECUTIVE_QUERY_ERRORS） */
  maxConsecutiveErrors?: number;
  /** 外部中断信号（如 SIGINT / 取消 Controller） */
  signal?: AbortSignal;
  /** 整体等待超时专用信号（用于精确区分超时与外部中断） */
  timeoutSignal?: AbortSignal;
  /** 进度输出写入间隔毫秒（0 表示禁用进度输出） */
  progressIntervalMs?: number;
  /** 是否静默模式（--quiet，关闭进度行输出） */
  quiet?: boolean;
  /** CLI 上下文（输出重定向） */
  context?: CliContext;
  /** 可注入的休眠函数（测试确定性控制） */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 可注入的时钟（测试确定性控制） */
  now?: () => number;
  /** 可注入的进程存活探测替身（测试确定性控制） */
  probe?: (pid: number) => boolean;
  /** 可注入的遗留心跳宽限期毫秒 */
  graceMs?: number;
}

/** 默认轮询间隔（毫秒）。 */
export const DEFAULT_WATCH_INTERVAL_MS = 2000;

/** 默认进度行输出间隔（毫秒）。 */
export const DEFAULT_WATCH_PROGRESS_INTERVAL_MS = 5000;

/** 单个运行允许的最大连续查询错误次数（超过后判定为致命观察失败）。 */
export const MAX_CONSECUTIVE_QUERY_ERRORS = 3;

/** requestId 反查默认等待预算（毫秒）：nohup 派工进程写入幂等键可能晚于 watch 启动。 */
export const DEFAULT_REQUEST_ID_RESOLVE_MS = 30_000;

/** requestId 反查结果条目。 */
export interface RequestIdResolution {
  /** 命中的幂等请求标识 */
  requestId: string;
  /** 反查得到的运行标识 */
  runId: string;
  /** 反查时刻已取到的运行记录 */
  record: RunRecord;
}

/**
 * 按幂等请求标识反查运行记录（带有限重试与歧义校验）。
 *
 * 语义规范：
 * - 无匹配：在反查预算内继续重试等待；
 * - 唯一匹配：得到 runId，进入等待；
 * - 多条匹配：明确抛出歧义异常，要求缩小包范围或直接指定 runId，严禁隐式选择最新记录；
 * - 查询不传待解析数量作为 limit 上限，防止隐藏并发或跨包重复匹配。
 *
 * @param service 目标作用域 Service 实例（本地或远端）
 * @param requestIds 待反查的幂等请求标识集合
 * @param options 轮询控制（intervalMs、resolveTimeoutMs、deadline、sleep、signal）
 * @returns 命中集合与超预算未命中集合
 */
export async function resolveRunsByRequestIds(
  service: ActionDockService,
  requestIds: string[],
  options: {
    packageId?: string;
    intervalMs: number;
    resolveTimeoutMs?: number;
    deadline?: number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    now?: () => number;
    signal?: AbortSignal;
  }
): Promise<{ resolved: RequestIdResolution[]; unresolved: string[] }> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const budgetMs = options.resolveTimeoutMs ?? DEFAULT_REQUEST_ID_RESOLVE_MS;
  const deadline =
    options.deadline !== undefined
      ? Math.min(options.deadline, startedAt + budgetMs)
      : startedAt + budgetMs;

  const resolveTimeoutController = new AbortController();
  const remainingBudget = Math.max(0, deadline - startedAt);
  let resolveTimer: NodeJS.Timeout | undefined;
  if (remainingBudget < Infinity) {
    resolveTimer = setTimeout(() => {
      resolveTimeoutController.abort();
    }, remainingBudget);
    if (resolveTimer.unref) resolveTimer.unref();
  }

  const querySignal = options.signal
    ? AbortSignal.any([options.signal, resolveTimeoutController.signal])
    : resolveTimeoutController.signal;

  const pending = new Set(requestIds);
  const resolved: RequestIdResolution[] = [];

  try {
    while (pending.size > 0) {
      if (now() >= deadline || querySignal.aborted) break;

      const missing = Array.from(pending);
      let records: RunRecord[] = [];
      try {
        // 严禁以 missing.length 作为 limit：必须全量拉取匹配记录以暴露潜在歧义
        records = await service.runs.list(
          { requestIds: missing, packageId: options.packageId },
          { signal: querySignal }
        );
      } catch (err: any) {
        if (querySignal.aborted) {
          records = [];
        } else {
          throw err;
        }
      }

      // 查询返回后，重新校验 now() >= deadline
      if (now() >= deadline || querySignal.aborted) {
        break;
      }

      const hitsByRequestId = new Map<string, RunRecord[]>();
      for (const record of records) {
        const rid = record.requestId;
        if (rid && pending.has(rid)) {
          const group = hitsByRequestId.get(rid) || [];
          group.push(record);
          hitsByRequestId.set(rid, group);
        }
      }

      for (const [rid, hits] of hitsByRequestId.entries()) {
        const distinctRunIds = Array.from(new Set(hits.map((h) => h.id)));
        if (distinctRunIds.length > 1) {
          throw new ExecutionError(
            `Request ID '${rid}' is ambiguous (${distinctRunIds.length} matching runs found: ${distinctRunIds.join(", ")}). Narrow the package scope with --package or specify the run ID directly.`
          );
        }
        if (distinctRunIds.length === 1) {
          pending.delete(rid);
          resolved.push({ requestId: rid, runId: distinctRunIds[0], record: hits[0] });
        }
      }

      if (pending.size === 0) break;

      const current = now();
      if (current >= deadline || querySignal.aborted) break;

      const remaining = deadline - current;
      await sleep(Math.min(options.intervalMs, Math.max(remaining, 1)), querySignal);
    }
  } finally {
    if (resolveTimer) clearTimeout(resolveTimer);
  }

  return { resolved, unresolved: Array.from(pending) };
}

/**
 * 中断感知休眠：信号触发时立即返回，超时时间自然到期返回。
 */
async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      resolve();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 单个运行的轮询追踪状态。 */
interface TrackedRun {
  source: WatchRunSource;
  record?: RunRecord;
  queryError?: unknown;
  consecutiveErrors: number;
  terminal: boolean;
}

function isAborted(poll: WatchPollContext, querySignal?: AbortSignal): boolean {
  return Boolean(poll.signal?.aborted || poll.timeoutSignal?.aborted || querySignal?.aborted);
}

/**
 * 对单个运行执行一次查询与存活校验。
 *
 * 核心设计：
 * - 任务终态 terminal 必须且仅能由 record.status 推导；
 * - 查询异常与宿主死亡属于观察失败，透传至 queryError，绝不修改 record.terminal；
 * - 瞬态查询错误容忍：非中止查询异常在未达连续失败阈值前保持现有状态重试，成功后重置计数；
 * - 确认宿主死亡时，以 HOST_LOST 立即记录观察失败并结束等待，严禁修改持久化运行记录。
 */
async function pollOnce(
  run: TrackedRun,
  poll: WatchPollContext
): Promise<void> {
  const service = poll.service;
  if (!service) {
    run.queryError = new Error("Watch scope service unavailable");
    return;
  }

  const querySignal =
    poll.signal && poll.timeoutSignal
      ? AbortSignal.any([poll.signal, poll.timeoutSignal])
      : poll.signal ?? poll.timeoutSignal;

  try {
    const record = await service.runs.get(run.source.runId, { signal: querySignal });
    if (isAborted(poll, querySignal)) {
      return;
    }
    if (record) {
      run.record = record;
      run.consecutiveErrors = 0;
      run.queryError = undefined;
      run.terminal = isTerminalRunStatus(record.status);

      // 本地非终态任务：检测宿主存活（只读旁观，不修改数据库记录）
      if (!run.terminal && run.source.source === "local") {
        const dead = isRunHostDead(record, {
          probe: poll.probe,
          graceMs: poll.graceMs,
        });
        if (dead) {
          run.queryError = {
            code: "HOST_LOST",
            message: `Execution host for run '${run.source.runId}' is lost or terminated unexpectedly`,
          };
        }
      }
    } else if (!run.record) {
      // 记录从未出现过：保持等待
      run.consecutiveErrors = 0;
    } else {
      // 曾被读到但当前查询返回空：保持最近已知状态
      run.consecutiveErrors = 0;
    }
  } catch (err: any) {
    if (isAborted(poll, querySignal)) {
      return;
    }
    run.consecutiveErrors += 1;
    const maxErrors = poll.maxConsecutiveErrors ?? MAX_CONSECUTIVE_QUERY_ERRORS;
    if (run.consecutiveErrors >= maxErrors) {
      // 达到连续失败阈值，才真正打上 queryError 并退出该 run 的观察
      run.queryError = err;
    }
  }
}

/**
 * 将追踪状态转换为聚合输出条目。
 */
function toOutcome(run: TrackedRun): WatchRunOutcome {
  const record = run.record;
  const outcome: WatchRunOutcome = {
    runId: run.source.runId,
    source: run.source.source,
    ...(run.source.requestId !== undefined ? { requestId: run.source.requestId } : {}),
    status: record?.status ?? "unknown",
    terminal: run.terminal,
  };
  if (record?.output !== undefined) {
    outcome.data = record.output;
  }
  if (run.queryError !== undefined) {
    outcome.queryError = run.queryError;
    const err = run.queryError;
    if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
      outcome.error = { code: (err as any).code, message: (err as any).message };
    } else if (err instanceof Error) {
      outcome.error = { code: (err as any).code ?? "WATCH_QUERY_FAILED", message: err.message };
    } else {
      outcome.error = { code: "WATCH_QUERY_FAILED", message: String(err) };
    }
  } else if (record?.error) {
    outcome.error = record.error;
  }
  if (typeof record?.durationMs === "number") {
    outcome.durationMs = record.durationMs;
  }
  return outcome;
}

/**
 * 执行统一轮询等待循环。
 *
 * @param sources 已完成归属解析的运行标识集合
 * @param poll 轮询依赖上下文
 * @returns 聚合结果（含逐运行终态、输出、错误及整体结束原因）
 */
export async function pollRunsUntilTerminal(
  sources: WatchRunSource[],
  poll: WatchPollContext
): Promise<WatchAggregation> {
  const sleep = poll.sleep ?? defaultSleep;
  const now = poll.now ?? Date.now;
  const progressIntervalMs =
    poll.progressIntervalMs !== undefined
      ? poll.progressIntervalMs
      : DEFAULT_WATCH_PROGRESS_INTERVAL_MS;
  const signal = poll.signal;
  const timeoutSignal = poll.timeoutSignal;
  const effectiveSignal =
    signal && timeoutSignal
      ? AbortSignal.any([signal, timeoutSignal])
      : signal ?? timeoutSignal;

  // 空集合边界防护：杜绝空集合假成功
  if (sources.length === 0) {
    return {
      ok: false,
      timedOut: false,
      interrupted: false,
      reason: "observation_failed",
      runs: [],
    };
  }

  const tracked: TrackedRun[] = sources.map((source) => ({
    source,
    record: source.initialRecord,
    consecutiveErrors: 0,
    terminal: source.initialRecord ? isTerminalRunStatus(source.initialRecord.status) : false,
  }));

  const startedAt = now();
  const deadline =
    poll.deadline !== undefined
      ? poll.deadline
      : poll.timeoutMs !== undefined
        ? startedAt + poll.timeoutMs
        : undefined;

  let lastProgressAt = startedAt;
  let interrupted = false;
  let timedOut = false;

  while (true) {
    // 待轮询集合：尚未到达终态且未出现致命观察异常
    const pending = tracked.filter((r) => !r.terminal && !r.queryError);
    if (pending.length === 0) break;

    await Promise.all(pending.map((r) => pollOnce(r, poll)));

    // 优先识别取消来源
    const current = now();
    const isTimeout =
      (deadline !== undefined && current >= deadline) ||
      Boolean(timeoutSignal?.aborted);

    if (isTimeout) {
      timedOut = true;
      break;
    }

    if (signal?.aborted) {
      interrupted = true;
      break;
    }

    const stillPending = tracked.filter((r) => !r.terminal && !r.queryError);
    if (stillPending.length === 0) break;

    if (
      !poll.quiet &&
      progressIntervalMs > 0 &&
      current - lastProgressAt >= progressIntervalMs
    ) {
      const finished = tracked.length - stillPending.length;
      writeStderr(
        `Waiting: ${stillPending.length} run(s) still running (${finished}/${tracked.length} settled)...`,
        poll.context
      );
      lastProgressAt = current;
    }

    const remainingToDeadline = deadline !== undefined ? deadline - current : undefined;
    const waitMs =
      remainingToDeadline !== undefined
        ? Math.min(poll.intervalMs, Math.max(remainingToDeadline, 1))
        : poll.intervalMs;
    await sleep(waitMs, effectiveSignal);

    const currentAfterSleep = now();
    const isTimeoutAfterSleep =
      (deadline !== undefined && currentAfterSleep >= deadline) ||
      Boolean(timeoutSignal?.aborted);

    if (isTimeoutAfterSleep) {
      timedOut = true;
      break;
    }

    if (signal?.aborted) {
      interrupted = true;
      break;
    }
  }

  const runs = tracked.map(toOutcome);
  const allTerminal = runs.length > 0 && runs.every((r) => r.terminal);
  const allSuccess = runs.length > 0 && runs.every((r) => r.terminal && r.status === "success" && !r.error);
  const anyObservationError = runs.some((r) => r.error !== undefined && !r.terminal);

  let reason: WatchEndReason;
  if (timedOut) {
    reason = "timeout";
  } else if (interrupted) {
    reason = "interrupted";
  } else if (anyObservationError || !allTerminal) {
    reason = "observation_failed";
  } else {
    reason = "all_terminal";
  }

  const ok = runs.length > 0 && allTerminal && allSuccess && reason === "all_terminal";
  return { ok, timedOut, interrupted, reason, runs };
}

/**
 * 提取错误条目的错误码与错误信息。
 */
function extractRunError(err: unknown): { code?: string; message: string } {
  if (typeof err === "object" && err !== null) {
    const code =
      "code" in err && (err as any).code !== undefined && (err as any).code !== null
        ? String((err as any).code)
        : undefined;
    const message =
      "message" in err && typeof (err as any).message === "string"
        ? (err as any).message
        : JSON.stringify(err);
    return { code, message };
  }
  if (typeof err === "string") {
    return { message: err };
  }
  return { message: String(err) };
}

/**
 * 人读模式渲染聚合结果：每运行一行终态摘要。
 */
export function renderWatchSummary(agg: WatchAggregation, remoteSuffix?: string): string {
  const lines: string[] = [];
  const scopeLabel = remoteSuffix ? `Watched Runs ${remoteSuffix}` : "Watched Runs";
  lines.push(`${scopeLabel} (${agg.runs.length}):\n`);
  lines.push(`  ${"RUN ID".padEnd(38)} ${"SOURCE".padEnd(8)} ${"REQUEST ID".padEnd(24)} ${"STATUS".padEnd(12)} DURATION`);
  lines.push("  " + "-".repeat(99));
  for (const r of agg.runs) {
    const duration =
      typeof r.durationMs === "number" ? `${r.durationMs}ms` : r.terminal ? "-" : "(in flight)";
    const requestId = (r.requestId || "-").padEnd(24);
    lines.push(
      `  ${r.runId.padEnd(38)} ${r.source.padEnd(8)} ${requestId} ${r.status.padEnd(12)} ${duration}`
    );
  }
  lines.push("");
  if (agg.reason === "timeout") {
    lines.push("Result: timed out before all runs reached a terminal state.");
  } else if (agg.reason === "interrupted") {
    lines.push("Result: interrupted before all runs reached a terminal state.");
  } else if (agg.reason === "observation_failed") {
    lines.push("Result: observation failed before all runs reached a terminal state (host lost or query error).");
  } else {
    lines.push(`Result: ${agg.ok ? "all runs succeeded" : "one or more runs failed"}.`);
  }

  const errorRuns = agg.runs.filter(
    (r) => r.error !== undefined || (r as any).queryError !== undefined
  );
  if (errorRuns.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const r of errorRuns) {
      const err = r.error ?? (r as any).queryError;
      const { code, message } = extractRunError(err);
      const errLabel = code ? `[${code}] ${message}` : message;
      lines.push(`  - Run ${r.runId}: ${errLabel}`);
    }
  }

  return lines.join("\n");
}

