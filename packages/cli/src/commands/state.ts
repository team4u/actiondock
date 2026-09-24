import {
  decodeStateKey,
} from "@actiondock/sdk";
import {
  findProjectRoot,
  loadProjectConfig,
} from "@actiondock/core";
import {
  resolvePackageRoot,
} from "@actiondock/core/registry";
import type { ResolvedTarget } from "@actiondock/core/profile";
import { Command } from "commander";
import { ArgumentError, ExecutionError, packageNotFoundError } from "../errors";
import { renderResult, renderStateList, writeStderr, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  getTargetRoot,
  remoteTargetLabel,
  resolveFallbackStrategy,
  resolveIntent,
  resolveTargetFromOptions,
  withService,
} from "../utils";
import {
  renderLinkedPackagesStateList,
  renderProjectScopedStateList,
} from "./state-list";

/**
 * 解耦后的状态键寻址视图（get、set、delete 三命令共享）。
 */
interface StateAddress {
  /** 生效命名空间（显式 -n 优先，其次复合键前缀；均无则 undefined） */
  namespace: string | undefined;
  /** 解耦后的裸键（显式 -n 时保持原始键串不拆解） */
  key: string;
}

/**
 * 统一预解码状态键寻址（get、set、delete 共享的单一事实源）。
 *
 * 三命令在 CLI 层即完成 `ns:key` 复合键解耦：
 * - 显式 `-n/--namespace` 指定时命名空间以其为准，键保持原串不拆解；
 * - 未显式指定时按复合键语法预解码出命名空间与裸键；
 * - 多冒号歧义键降级为整串裸键并提示。
 *
 * 歧义键（如 `review:owner/repo:42`）不再直接崩溃：
 * 降级为「整串作为裸 key」并在 stderr 提示可用 -n/--namespace 显式指定，
 * 保持与本地存储层歧义兜底（deleteStateSmart 的纯键回退）一致的容错语义。
 *
 * 本地与远端分支都消费解耦后的 namespace + key，
 * 消除「set 预解码而 get/delete 依赖存储层回退」的语义不对称。
 */
function resolveStateAddress(
  rawKey: string,
  options: { namespace?: string },
  context?: CliContext
): StateAddress {
  if (options.namespace !== undefined) {
    return { namespace: options.namespace, key: rawKey };
  }
  try {
    const decoded = decodeStateKey(rawKey);
    return { namespace: decoded.namespace || undefined, key: decoded.key };
  } catch {
    writeStderr(
      `[WARN] State key '${rawKey}' contains multiple colon delimiters; treating it as a bare key. Use -n/--namespace to specify the namespace explicitly.`,
      context
    );
    return { namespace: undefined, key: rawKey };
  }
}

/**
 * 状态命令的作用域解析结果（get、set、delete、clear 共享）。
 *
 * 远端与本地分支的命令体结构完全同构（解析作用域 → 调端口 → 统一消息），
 * 差异仅体现在以下维度，由本视图一次性收敛：
 * - 端口寻址使用的包标识（远端为 -P 原值，本地为工程配置 id）；
 * - not-found 判定与成功消息的作用域后缀；
 * - 本地分支的工程根目录、工程配置与剥离 pkg/ 前缀后的裸键。
 *
 * 本地分支的 localRoot 由本视图一并透出，供 withService 的惰性工厂消费，
 * 保证 getTargetRoot 在单次命令执行中至多求值一次。
 */
interface StateScope {
  /** 端口寻址使用的包标识 */
  packageId: string;
  /** not-found 与 set 成功消息的作用域后缀（on remote server / in package '...'） */
  scopeSuffix: string;
  /** delete 成功消息的作用域后缀（on remote server / from package '...'） */
  deleteSuffix: string;
  /** 剥离 pkg/ 前缀后的裸键（远端分支等于原始键） */
  effectiveKey: string;
  /** 本地工程配置（仅本地分支存在） */
  projConfig: ReturnType<typeof loadProjectConfig> | undefined;
  /** 本地工程根目录（远端分支为 undefined） */
  localRoot: string | undefined;
}

/**
 * 解析状态命令目标作用域（remote 与 local 双分支模板的单一事实源）。
 *
 * 远端分支直接以 -P 参数寻址，消息后缀固定为 "on remote server"；
 * 本地分支基于 getTargetRoot 完成包寻址（含从键中剥离 pkg/ 前缀），
 * 以工程配置 id 寻址，消息后缀为 "in/from package '...'"。
 *
 * @param resolved 目标拓扑解析结果
 * @param options 命令选项视图
 * @param rawKey 原始键（本地分支用于剥离 pkg/ 前缀）
 * @returns 作用域解析结果（含包标识、消息后缀、本地根目录与工程配置）
 */
function resolveStateScope(
  resolved: ResolvedTarget,
  options: { package?: string },
  rawKey?: string
): StateScope {
  if (resolved.type === "remote") {
    return {
      packageId: options.package || "",
      scopeSuffix: "on remote server",
      deleteSuffix: "on remote server",
      effectiveKey: rawKey || "",
      projConfig: undefined,
      localRoot: undefined,
    };
  }

  // 本地项目模式：getTargetRoot 会从键中剥离 pkg/ 前缀，寻址基于解耦后的裸键
  const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
  const projConfig = loadProjectConfig(root);
  return {
    packageId: projConfig.id,
    scopeSuffix: `in package '${projConfig.id}'`,
    deleteSuffix: `from package '${projConfig.id}'`,
    effectiveKey,
    projConfig,
    localRoot: root,
  };
}

/**
 * 注册 state 状态管理命令（get、set、delete、clear、keys、list）。
 *
 * @param program Commander 根程序对象
 * @param context CLI 上下文
 */
export function registerStateCommands(program: Command, context?: CliContext): void {
  const stateCmd = program
    .command("state")
    .description("Inspect and manage Shared State store");

  // state list / keys 共享实现（远端、本地项目、链接包聚合三分支）
  const handleListKeys = async (prefix: string = "", rawOptions: any, cmd: any) => {
    const options = getEffectiveOptions(rawOptions, cmd);
    const effectiveIntent = resolveIntent(options.intent, prefix ? [prefix] : []);
    const { shouldFallback } = resolveFallbackStrategy(options);

    await withService(options, context, async (service, resolved) => {
      const actionId = options.action || "";

      // 远端服务模式：直接列举远端包作用域键
      if (resolved.type === "remote") {
        const keys = (await service.management?.state.list(options.package || "", actionId, {
          namespace: options.namespace,
          prefix,
        })) ?? [];

        renderResult(keys, {
          json: options.json,
          humanFormatter: () =>
            renderStateList(
              keys,
              remoteTargetLabel(resolved),
              false,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 本地工程与链接包模式：按目标根目录决策输出范围
      let targetRoot: string | null = null;
      if (options.package) {
        targetRoot = resolvePackageRoot(options.package);
        if (!targetRoot) {
          throw packageNotFoundError(options.package);
        }
      } else {
        targetRoot = findProjectRoot();
      }

      if (targetRoot) {
        await renderProjectScopedStateList({
          service,
          targetRoot,
          actionId,
          prefix,
          options,
          effectiveIntent,
          shouldFallback,
          context,
        });
        return;
      }

      await renderLinkedPackagesStateList({
        service,
        actionId,
        prefix,
        options,
        effectiveIntent,
        shouldFallback,
        context,
      });
    });
  };

  // state list
  applyTargetOptions(
    stateCmd
      .command("list [prefix]")
      .description("List state keys in current project or linked packages")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-a, --action <id>", "Action identifier scope")
      .option("-n, --namespace <ns>", "Filter keys under specific namespace (omit to list all namespaces)")
  )
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--detail", "Include metadata (ttl, expiresAt, size, updatedAt) in JSON output")
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(handleListKeys);

  // state keys 别名
  applyTargetOptions(
    stateCmd
      .command("keys [prefix]")
      .description("Alias for 'ad state list [prefix]'")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-a, --action <id>", "Action identifier scope")
      .option("-n, --namespace <ns>", "Filter keys under specific namespace")
  )
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter")
    .option("--detail", "Include metadata in JSON output")
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(handleListKeys);

  // state get <key>
  applyTargetOptions(
    stateCmd
      .command("get <key>")
      .description("Get state value by key (supports composite 'ns:key' and detail mode)")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-a, --action <id>", "Action identifier scope")
      .option("-n, --namespace <ns>", "Explicit namespace scope for key")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (rawKey: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey) {
        throw new ArgumentError("State key is required");
      }

      // 惰性作用域缓存：仅本地分支求值一次，避免远端模式触发包寻址副作用
      let scope: StateScope | undefined;
      const resolveScope = (resolved: ResolvedTarget): StateScope =>
        (scope ??= resolveStateScope(resolved, options, rawKey));

      await withService(
        options,
        context,
        async (service, resolved) => {
          const actionId = options.action || "";
          const targetScope = resolveScope(resolved);
          const address = resolveStateAddress(targetScope.effectiveKey, options, context);

          const entry = await service.management?.state.get(targetScope.packageId, actionId, address.key, {
            namespace: address.namespace,
            detail: true,
          });

          if (entry === undefined || (entry as any).value === undefined) {
            throw new ExecutionError(`State key '${rawKey}' not found ${targetScope.scopeSuffix}`);
          }

          const val = (entry as any).value;
          const matchedNamespace = resolved.type === "remote" ? ((entry as any).namespace || address.namespace) : (entry as any).namespace;

          renderResult(
            { key: rawKey, value: val, namespace: matchedNamespace },
            {
              json: options.json,
              humanFormatter: () => (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)),
              context,
            }
          );
        },
        { localRoot: () => resolveScope(resolveTargetFromOptions(options, context)).localRoot }
      );
    });

  // state set <key> <value>
  applyTargetOptions(
    stateCmd
      .command("set <key> <value>")
      .description("Set state key-value (supports JSON value, composite 'ns:key', and --ttl)")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-a, --action <id>", "Action identifier scope")
      .option("-n, --namespace <ns>", "Explicit namespace scope for key")
      .option("--ttl <seconds>", "Time-To-Live expiration in seconds")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawKey: string, rawVal: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey || rawVal === undefined) {
        throw new ArgumentError("Both key and value are required for state set");
      }

      let parsedVal: unknown = rawVal;
      try {
        parsedVal = JSON.parse(rawVal);
      } catch {
        parsedVal = rawVal;
      }

      const ttlSec = options.ttl ? parseInt(options.ttl, 10) : undefined;
      if (options.ttl && (isNaN(ttlSec!) || ttlSec! <= 0)) {
        throw new ArgumentError(`Invalid --ttl value: '${options.ttl}'. Must be a positive integer.`);
      }

      // 惰性作用域缓存：仅本地分支求值一次，避免远端模式触发包寻址副作用
      let scope: StateScope | undefined;
      const resolveScope = (resolved: ResolvedTarget): StateScope =>
        (scope ??= resolveStateScope(resolved, options, rawKey));

      await withService(
        options,
        context,
        async (service, resolved) => {
          const actionId = options.action || "";
          const targetScope = resolveScope(resolved);
          const address = resolveStateAddress(targetScope.effectiveKey, options, context);

          await service.management?.state.set(targetScope.packageId, actionId, address.key, parsedVal as any, {
            namespace: address.namespace,
            ttl: ttlSec,
          });

          // 远端回显原始键；本地回显解耦后的 ns:key 复合视图
          const displayKey = resolved.type === "remote" ? rawKey : (address.namespace ? `${address.namespace}:${address.key}` : address.key);
          writeStdout(`[OK] State '${displayKey}' updated ${targetScope.scopeSuffix}`, context);
        },
        { localRoot: () => resolveScope(resolveTargetFromOptions(options, context)).localRoot }
      );
    });

  // state delete <key>
  applyTargetOptions(
    stateCmd
      .command("delete <key>")
      .alias("rm")
      .description("Delete state key entry")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-a, --action <id>", "Action identifier scope")
      .option("-n, --namespace <ns>", "Explicit namespace scope for key")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawKey: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey) {
        throw new ArgumentError("State key is required");
      }

      // 惰性作用域缓存：仅本地分支求值一次，避免远端模式触发包寻址副作用
      let scope: StateScope | undefined;
      const resolveScope = (resolved: ResolvedTarget): StateScope =>
        (scope ??= resolveStateScope(resolved, options, rawKey));

      await withService(
        options,
        context,
        async (service, resolved) => {
          const actionId = options.action || "";
          const targetScope = resolveScope(resolved);
          const address = resolveStateAddress(targetScope.effectiveKey, options, context);

          const deleted = await service.management?.state.delete(targetScope.packageId, actionId, address.key, {
            namespace: address.namespace,
          });

          if (!deleted) {
            throw new ExecutionError(`State key '${rawKey}' not found ${targetScope.scopeSuffix}`);
          }

          writeStdout(`[OK] State '${rawKey}' deleted ${targetScope.deleteSuffix}`, context);
        },
        { localRoot: () => resolveScope(resolveTargetFromOptions(options, context)).localRoot }
      );
    });

  // state clear
  applyTargetOptions(
    stateCmd
      .command("clear")
      .alias("clean")
      .description("Clear state entries (supports namespace cleanup or global wipe via --all)")
      .option("-P, --package <id>", "Target package ID or path")
      .option("--action <id>", "Action identifier scope")
      .option("-n, --namespace <ns>", "Target namespace to clear (required unless --all is specified)")
      .option("-a, --all", "Dangerously clear all state namespaces for the package")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!options.all && options.namespace === undefined) {
        throw new ArgumentError(
          "Must specify either -n/--namespace <name> to clear specific namespace, or --all to clear entire package state store."
        );
      }

      // 惰性作用域缓存：仅本地分支求值一次，避免远端模式触发包寻址副作用
      let scope: StateScope | undefined;
      const resolveScope = (resolved: ResolvedTarget): StateScope =>
        (scope ??= resolveStateScope(resolved, options));

      await withService(options, context, async (service, resolved) => {
        const actionId = options.action || "";

        if (resolved.type === "remote") {
          const count = (await service.management?.state.clear(options.package || "", actionId, {
            namespace: options.namespace,
            all: Boolean(options.all),
          })) ?? 0;
          writeStdout(`[OK] Cleared ${count} state entry(s) on remote server`, context);
          return;
        }

        // 本地项目模式
        const targetScope = resolveScope(resolved);

        const count = (await service.management?.state.clear(targetScope.packageId, actionId, {
          namespace: options.namespace,
          all: Boolean(options.all),
        })) ?? 0;

        const scopeDesc = options.all
          ? "all namespaces"
          : `namespace '${options.namespace}'`;
        writeStdout(`[OK] Cleared ${count} state entry(s) in ${scopeDesc} for package '${targetScope.projConfig!.id}'`, context);
      },
      { localRoot: () => resolveScope(resolveTargetFromOptions(options, context)).localRoot });
    });
}
