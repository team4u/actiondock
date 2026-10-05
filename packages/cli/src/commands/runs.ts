import {
  loadProjectConfig,
  parseDuration,
  type ActionDockService,
} from "@actiondock/core";
import {
  filterWithFallbackInfo,
} from "@actiondock/core/project";
import {
  listLinkedPackages,
} from "@actiondock/core/registry";
import { Command } from "commander";
import {
  ArgumentError,
  ExecutionError,
  NO_PROJECT_NO_LINKED_MESSAGE,
} from "../errors";
import { renderResult, renderRunDetail, renderRunsList, writeStdout } from "../renderer";
import {
  pollRunsUntilTerminal,
  renderWatchSummary,
  resolveRunsByRequestIds,
  type RequestIdResolution,
  type WatchRunSource,
} from "../services/run-watch";
import type { CliContext } from "../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  remoteTargetSuffix,
  requirePackageRoot,
  resolveFallbackStrategy,
  resolveIntent,
  resolveLocalPackageRoot,
  withService,
} from "../utils";

/**
 * 解析本地目标包根目录与工程配置（仅在 local 分支调用）。
 * 显式指定包且寻址失败时抛出参数错误；工程清单损坏时降级为链接包视图。
 */
function resolveLocalRunScope(packageOption?: string): {
  targetPackageRoot: string | undefined;
  projConfig: any;
} {
  if (packageOption) {
    const { root } = requirePackageRoot(packageOption);
    try {
      return { targetPackageRoot: root, projConfig: loadProjectConfig(root) };
    } catch {
      // 工程清单损坏时降级为链接包作用域视图
      return { targetPackageRoot: root, projConfig: null };
    }
  }

  const root = resolveLocalPackageRoot();
  if (!root) {
    return { targetPackageRoot: undefined, projConfig: null };
  }
  try {
    return { targetPackageRoot: root, projConfig: loadProjectConfig(root) };
  } catch {
    // 工程清单损坏时降级为链接包作用域视图
    return { targetPackageRoot: root, projConfig: null };
  }
}

/**
 * 解析 watch 命令的正时长选项值（毫秒）。
 * 格式非法或非正值时抛参数错误（退出码 2）。
 */
function parsePositiveDuration(raw: string | undefined, flagName: string): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    throw new ArgumentError(`Invalid ${flagName} argument: value is required`);
  }
  let ms: number | undefined;
  try {
    ms = parseDuration(String(raw));
  } catch (err: any) {
    throw new ArgumentError(`Invalid ${flagName} argument: ${err.message}`);
  }
  if (ms === undefined || ms <= 0) {
    throw new ArgumentError(
      `Invalid ${flagName} argument: must be a positive duration (e.g. 500ms, 2s)`
    );
  }
  return ms;
}

/**
 * Commander 可重复选项收集函数：同一选项多次出现时累积为数组。
 */
function collectRepeatableOption(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * 归一化 requestId 选项值为去重后的非空原样字符串数组。
 * 将 requestId 作为不作解释的原样字符串，不拆分逗号、不剔除首尾空白，只做非空有效字符串检查与去重。
 */
export function normalizeRequestIds(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : raw !== undefined && raw !== null ? [raw] : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.length > 0) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}


/**
 * 注册 runs 动作执行历史管理命令（list、show、watch、clear、cancel）。
 *
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerRunsCommands(program: Command, context?: CliContext): void {
  const runsCmd = program
    .command("runs")
    .description("Inspect action execution history");

  // runs list
  applyTargetOptions(
    runsCmd
      .command("list [patterns...]")
      .description("List recent execution records")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
      .option("-a, --action <actionId>", "Filter by action ID")
      .option("--request-id <id>", "Filter by idempotency request ID (repeatable)", collectRepeatableOption, [])
      .option("-n, --limit <count>", "Maximum number of records to return", "20")
  )
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const { shouldFallback } = resolveFallbackStrategy(options);
      const limit = Number.parseInt(options.limit, 10) || 20;
      const requestIds = normalizeRequestIds(options.requestId);
      const scope = resolveLocalRunScope(options.package);

      // 通过 Service 门面统一访问
      await withService(
        options,
        context,
        async (service, resolved) => {
          // limit 下推查询层：intent 过滤发生在内存（过滤后仍需截断到用户值），
          // 下推时附加合理裕量，保证过滤后可截断数量不少于用户请求
          const FETCH_HEADROOM = 200;
          const queryLimit = effectiveIntent ? limit + FETCH_HEADROOM : limit;
          const records = await service.runs.list({
            packageId: options.package,
            actionId: options.action,
            requestIds: requestIds.length > 0 ? requestIds : undefined,
            limit: queryLimit,
          });

          // 若处于本地无项目环境且无任何软链接包，则直接输出友好提示
          if (resolved.type === "local" && !scope.targetPackageRoot) {
            const linked = listLinkedPackages(context?.customHome);
            if (linked.length === 0) {
              renderResult([], {
                json: options.json,
                humanFormatter: () => NO_PROJECT_NO_LINKED_MESSAGE,
                context,
              });
              return;
            }
          }

          const filterRes = filterWithFallbackInfo(
            records,
            effectiveIntent,
            [(r) => r.id, (r) => r.actionId, (r) => (r as any).packageId, (r) => r.status, (r) => r.error?.message],
            shouldFallback
          );

          const capped = filterRes.items.slice(0, limit);

          renderResult(capped, {
            json: options.json,
            humanFormatter: () => {
              let title = "Execution Runs";
              if (resolved.type === "remote") {
                title = `Execution Runs ${remoteTargetSuffix(resolved)}`;
              } else if (scope.projConfig) {
                title = `Execution Runs in ${scope.projConfig.name} (${scope.projConfig.id})`;
              } else {
                title = "Execution Runs (Linked Packages)";
              }
              return renderRunsList(capped, title, filterRes.isFallback, effectiveIntent);
            },
            context,
          });
        },
        { localRoot: scope.targetPackageRoot, scanLinkedPackages: true }
      );
    });

  // runs show <id>
  applyTargetOptions(
    runsCmd
      .command("show <id>")
      .description("Show details of a specific execution run")
      .option("-P, --package <id>", "Target package ID or path")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Run ID is required");
      }

      const scope = resolveLocalRunScope(options.package);

      // 通过 Service 门面统一查询
      await withService(
        options,
        context,
        async (service, resolved) => {
          const run = await service.runs.get(id);
          if (!run) {
            if (resolved.type === "remote") {
              throw new ExecutionError(`Run record '${id}' not found on remote server`);
            } else if (options.package) {
              throw new ExecutionError(`Run record '${id}' not found in package '${scope.projConfig?.id || options.package}'`);
            } else {
              throw new ExecutionError(`Run record '${id}' not found in current project or any linked packages`);
            }
          }

          renderResult(run, {
            json: options.json,
            humanFormatter: () => renderRunDetail(run),
            context,
          });
        },
        { localRoot: scope.targetPackageRoot, scanLinkedPackages: true }
      );
    });

  // runs watch [ids...] / --request-id <id>
  applyTargetOptions(
    runsCmd
      .command("watch [ids...]")
      .description("Block until the given runs reach a terminal state, then aggregate results")
      .option("-P, --package <id>", "Target package ID or path")
      .option(
        "--request-id <id>",
        "Wait by idempotency request ID(s) instead of run IDs (repeatable)",
        collectRepeatableOption,
        []
      )
  )
    .option("--resolve-timeout <duration>", "Budget for resolving --request-id to run IDs (e.g. 30s)", "30s")
    .option("--timeout <duration>", "Overall wait limit (e.g. 30s, 5m, 500ms); exits with current statuses on expiry")
    .option("--interval <duration>", "Polling interval (e.g. 500ms, 30s)", "2s")
    .option("-q, --quiet", "Suppress periodic waiting progress lines")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (ids: string[], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const watchIds = (ids || []).filter((id: string) => id && id.trim());
      const requestIds = normalizeRequestIds(options.requestId);
      if (watchIds.length === 0 && requestIds.length === 0) {
        throw new ArgumentError(
          "At least one run ID or --request-id is required for watch"
        );
      }

      const intervalMs = parsePositiveDuration(options.interval, "--interval");
      const timeoutMs = options.timeout
        ? parsePositiveDuration(options.timeout, "--timeout")
        : undefined;
      const resolveTimeoutMs = parsePositiveDuration(
        options.resolveTimeout,
        "--resolve-timeout"
      );

      // 从命令入口开始计算统一绝对截止时间
      const commandStartedAt = Date.now();
      const overallDeadline =
        timeoutMs !== undefined ? commandStartedAt + timeoutMs : undefined;

      const effectiveControl = context?.control;
      const externalSignal = effectiveControl?.signal;

      // 绑定统一超时与外部取消信号至读取取消控制器
      const timeoutController =
        overallDeadline !== undefined ? new AbortController() : undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;
      if (overallDeadline !== undefined) {
        const remainingDelay = Math.max(0, overallDeadline - commandStartedAt);
        timeoutTimer = setTimeout(() => {
          timeoutController?.abort();
        }, remainingDelay);
        if (timeoutTimer.unref) timeoutTimer.unref();
      }

      const readSignal =
        externalSignal && timeoutController
          ? AbortSignal.any([externalSignal, timeoutController.signal])
          : externalSignal ?? timeoutController?.signal;

      try {
        // 单一环境服务生命周期：一次 withService 包住标识解析和整个等待过程
        await withService(
          options,
          context,
          async (service, resolved) => {
            const scope =
              resolved.type === "local"
                ? resolveLocalRunScope(options.package)
                : undefined;
            const normalizedPackageId = options.package
              ? (resolved.type === "remote" ? options.package : scope?.projConfig?.id || options.package)
              : undefined;
            const whereDescription =
              resolved.type === "remote"
                ? `on remote server ${resolved.serverUrl || ""}`
                : options.package
                  ? `in package '${normalizedPackageId}'`
                  : "in current project or any linked packages";

            // 1. 解析 requestId
            const resolvedMap = new Map<string, RequestIdResolution>();
            if (requestIds.length > 0) {
              const current = Date.now();
              const resolveDeadline =
                overallDeadline !== undefined
                  ? Math.min(overallDeadline, commandStartedAt + resolveTimeoutMs)
                  : commandStartedAt + resolveTimeoutMs;
              const remainingResolveBudgetMs = Math.max(0, resolveDeadline - current);

              const resolveTimeoutController = new AbortController();
              let resolveTimer: NodeJS.Timeout | undefined;
              if (remainingResolveBudgetMs < Infinity) {
                resolveTimer = setTimeout(() => {
                  resolveTimeoutController.abort();
                }, remainingResolveBudgetMs);
                if (resolveTimer.unref) resolveTimer.unref();
              }

              const resolveSignals: AbortSignal[] = [resolveTimeoutController.signal];
              if (externalSignal) resolveSignals.push(externalSignal);
              if (timeoutController) resolveSignals.push(timeoutController.signal);
              const resolveSignal = AbortSignal.any(resolveSignals);

              let hits: RequestIdResolution[] = [];
              let unresolved: string[] = [];
              try {
                const res = await resolveRunsByRequestIds(
                  service,
                  requestIds,
                  {
                    packageId: normalizedPackageId,
                    intervalMs,
                    resolveTimeoutMs: remainingResolveBudgetMs,
                    deadline: resolveDeadline,
                    signal: resolveSignal,
                  }
                );
                hits = res.resolved;
                unresolved = res.unresolved;
              } finally {
                if (resolveTimer) clearTimeout(resolveTimer);
              }

              // 查询返回后再次校验截止时间
              if (unresolved.length > 0 || Date.now() >= resolveDeadline) {
                const missingList = unresolved.length > 0 ? unresolved : requestIds;
                throw new ExecutionError(
                  `Request ID(s) not found ${whereDescription} within ${options.resolveTimeout}: ${missingList.join(", ")}`
                );
              }

              for (const hit of hits) {
                resolvedMap.set(hit.requestId, hit);
              }
            }

            // 2. 保持用户输入顺序与 runId 去重
            const sources: WatchRunSource[] = [];
            const seenRunIds = new Set<string>();

            // 先按用户输入的位置参数添加
            for (const id of watchIds) {
              if (seenRunIds.has(id)) continue;
              seenRunIds.add(id);
              sources.push({ runId: id, source: resolved.type });
            }

            // 再按用户输入的 --request-id 顺序添加或补齐
            for (const reqId of requestIds) {
              const hit = resolvedMap.get(reqId);
              if (!hit) continue;
              const existing = sources.find((s) => s.runId === hit.runId);
              if (existing) {
                if (!existing.requestId) existing.requestId = hit.requestId;
                if (!existing.initialRecord) existing.initialRecord = hit.record;
              } else if (!seenRunIds.has(hit.runId)) {
                seenRunIds.add(hit.runId);
                sources.push({
                  runId: hit.runId,
                  source: resolved.type,
                  requestId: hit.requestId,
                  initialRecord: hit.record,
                });
              }
            }

            // 3. 校验位置参数 runId 是否存在与归属校验
            const notFound: string[] = [];
            for (const source of sources) {
              if (!source.initialRecord) {
                const record = await service.runs.get(source.runId, { signal: readSignal });
                if (record) {
                  if (normalizedPackageId && record.packageId !== normalizedPackageId) {
                    notFound.push(source.runId);
                  } else {
                    source.initialRecord = record;
                  }
                } else {
                  notFound.push(source.runId);
                }
              } else if (normalizedPackageId && source.initialRecord.packageId !== normalizedPackageId) {
                notFound.push(source.runId);
              }
            }

            if (notFound.length > 0) {
              throw new ExecutionError(
                `Run record(s) not found ${whereDescription}: ${notFound.join(", ")}`
              );
            }

            if (sources.length === 0) {
              throw new ArgumentError("At least one valid run is required for watch");
            }

            // 4. 等待结果
            const remainingOverallMs =
              overallDeadline !== undefined
                ? Math.max(0, overallDeadline - Date.now())
                : undefined;

            const aggregation = await pollRunsUntilTerminal(sources, {
              service,
              intervalMs,
              timeoutMs: remainingOverallMs,
              deadline: overallDeadline,
              signal: externalSignal,
              timeoutSignal: timeoutController?.signal,
              quiet: options.quiet || options.json,
              context,
            });

            // 5. 输出结果（携带 reason、timedOut、interrupted 与逐运行结果）
            if (options.json) {
              writeStdout(
                JSON.stringify(
                  {
                    ok: aggregation.ok,
                    timedOut: aggregation.timedOut,
                    interrupted: aggregation.interrupted,
                    reason: aggregation.reason,
                    runs: aggregation.runs.map((r) => ({
                      runId: r.runId,
                      source: r.source,
                      ...(r.requestId !== undefined ? { requestId: r.requestId } : {}),
                      status: r.status,
                      terminal: r.terminal,
                      ...(r.data !== undefined ? { data: r.data } : {}),
                      ...(r.error !== undefined ? { error: r.error } : {}),
                    })),
                  },
                  null,
                  2
                ),
                context
              );
            } else {
              writeStdout(
                renderWatchSummary(
                  aggregation,
                  resolved.type === "remote" ? remoteTargetSuffix(resolved) : undefined
                ),
                context
              );
            }

            if (!aggregation.ok) {
              if (context) {
                context.exitCode = 1;
              }
              if (!context?.control) {
                process.exitCode = 1;
              }
            }
          },
          {
            localRoot: () => resolveLocalRunScope(options.package).targetPackageRoot,
            scanLinkedPackages: !options.package,
          }
        );
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
    });

  // runs cancel
  applyTargetOptions(
    runsCmd
      .command("cancel <id>")
      .description("Cancel a running action execution on a remote server")
  )
    .option("-r, --reason <reason>", "Reason for cancellation")
    .option("--json", "Output as JSON")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Run ID is required for cancel");
      }

      await withService(
        options,
        context,
        async (service) => {
          const result = await service.runs.cancel(id, options.reason);
          const isErrorOutcome = result.outcome === "not_found" || result.outcome === "not_owner";
          renderResult(result, {
            json: options.json,
            humanFormatter: () => {
              if (result.outcome === "not_found") {
                return `Error: Run record '${id}' not found on remote server.`;
              }
              if (result.outcome === "not_owner") {
                return `Error: Cannot cancel run '${id}': not the owner.`;
              }
              return `Run '${id}' cancellation requested (Status: ${(result as any).status || result.outcome}).`;
            },
            context,
          });
          if (isErrorOutcome) {
            process.exitCode = 1;
          }
        },
        { requireRemote: true }
      );
    });

  // runs clear
  applyTargetOptions(
    runsCmd
      .command("clear")
      .description("Clear execution run records")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-a, --action <actionId>", "Filter by action ID")
      .option("--status <status>", "Filter by run status (e.g. success, failed)")
      .option("--older-than <duration>", "Only clear runs older than specified duration (e.g. 14d, 7d, 24h, 30m)")
      .option("--keep <count>", "Keep the most recent N runs and clear older ones")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);

      let targetPackageRoot: string | undefined;
      let packageId = options.package;
      if (!options.profile && !options.server) {
        targetPackageRoot = requirePackageRoot(options.package).root;
        try {
          packageId = loadProjectConfig(targetPackageRoot).id;
        } catch {
          // 清单损坏时保留原始 -P 参数作为包标识
        }
      }

      let olderThanMs: number | undefined;
      if (options.olderThan) {
        try {
          olderThanMs = parseDuration(options.olderThan);
        } catch (err: any) {
          throw new ArgumentError(`Invalid --older-than argument: ${err.message}`);
        }
      }

      let keep: number | undefined;
      if (options.keep !== undefined) {
        const parsed = parseInt(String(options.keep), 10);
        if (isNaN(parsed) || parsed < 0) {
          throw new ArgumentError("Invalid --keep argument: must be a non-negative integer");
        }
        keep = parsed;
      }

      await withService(
        options,
        context,
        async (service, resolved) => {
          const count = service.runs.clear
            ? await service.runs.clear({
                packageId,
                actionId: options.action,
                status: options.status,
                olderThanMs,
                keep,
              })
            : 0;

          const filters: string[] = [];
          if (options.action) filters.push(`action='${options.action}'`);
          if (options.status) filters.push(`status='${options.status}'`);
          if (options.olderThan) filters.push(`older than ${options.olderThan}`);
          if (keep !== undefined) filters.push(`keeping newest ${keep}`);
          const filterDesc = filters.length > 0 ? ` (${filters.join(", ")})` : "";

          const payload = { ok: true, clearedCount: count };
          renderResult(payload, {
            json: options.json,
            humanFormatter: () =>
              resolved.type === "remote"
                ? `Cleared ${count} execution run(s) on remote server${filterDesc}.`
                : `Cleared ${count} execution run(s) in package '${packageId}'${filterDesc}.`,
            context,
          });
        },
        { localRoot: targetPackageRoot }
      );
    });
}
