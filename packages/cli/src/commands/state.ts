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
  withService,
} from "../utils";
import {
  renderLinkedPackagesStateList,
  renderProjectScopedStateList,
} from "./state-list";

/**
 * 解析复合状态键为命名空间与裸键视图。
 *
 * 多冒号歧义键（如 `review:owner/repo:42`）不再直接崩溃：
 * 降级为「整串作为裸 key」并在 stderr 提示可用 -n/--namespace 显式指定，
 * 保持与本地存储层歧义兜底（deleteStateSmart 的纯键回退）一致的容错语义。
 */
function decodeStateKeyWithFallback(
  rawKey: string,
  hasExplicitNamespace: boolean,
  context?: CliContext
): { namespace: string | undefined; key: string } {
  try {
    const decoded = decodeStateKey(rawKey);
    return { namespace: decoded.namespace || undefined, key: decoded.key };
  } catch {
    if (!hasExplicitNamespace) {
      writeStderr(
        `[WARN] State key '${rawKey}' contains multiple colon delimiters; treating it as a bare key. Use -n/--namespace to specify the namespace explicitly.`,
        context
      );
    }
    return { namespace: undefined, key: rawKey };
  }
}

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
  const decoded = decodeStateKeyWithFallback(rawKey, false, context);
  return { namespace: decoded.namespace, key: decoded.key };
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

      await withService(
        options,
        context,
        async (service, resolved) => {
          const actionId = options.action || "";

          if (resolved.type === "remote") {
            const address = resolveStateAddress(rawKey, options, context);

            const entry = await service.management?.state.get(options.package || "", actionId, address.key, {
              namespace: address.namespace,
              detail: true,
            });

            if (entry === undefined || (entry as any).value === undefined) {
              throw new ExecutionError(`State key '${rawKey}' not found on remote server`);
            }

            const val = (entry as any).value;
            renderResult(
              { key: rawKey, value: val, namespace: (entry as any).namespace || address.namespace },
              {
                json: options.json,
                humanFormatter: () => (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)),
                context,
              }
            );
            return;
          }

          // 本地项目模式：getTargetRoot 会从键中剥离 pkg/ 前缀，寻址基于解耦后的裸键
          const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
          const address = resolveStateAddress(effectiveKey, options, context);
          const projConfig = loadProjectConfig(root);

          const entry = await service.management?.state.get(projConfig.id, actionId, address.key, {
            namespace: address.namespace,
            detail: true,
          });

          if (entry === undefined || (entry as any).value === undefined) {
            throw new ExecutionError(`State key '${rawKey}' not found in package '${projConfig.id}'`);
          }

          const val = (entry as any).value;
          const matchedNamespace = (entry as any).namespace;

          renderResult(
            { key: rawKey, value: val, namespace: matchedNamespace },
            {
              json: options.json,
              humanFormatter: () => (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)),
              context,
            }
          );
        },
        { localRoot: () => getTargetRoot(options.package, rawKey).root }
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

      await withService(
        options,
        context,
        async (service, resolved) => {
          const actionId = options.action || "";

          if (resolved.type === "remote") {
            const address = resolveStateAddress(rawKey, options, context);
            await service.management?.state.set(options.package || "", actionId, address.key, parsedVal as any, {
              namespace: address.namespace,
              ttl: ttlSec,
            });

            writeStdout(`[OK] State '${rawKey}' updated on remote server`, context);
            return;
          }

          // 本地项目模式：getTargetRoot 会从键中剥离 pkg/ 前缀，寻址基于解耦后的裸键
          const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
          const address = resolveStateAddress(effectiveKey, options, context);
          const projConfig = loadProjectConfig(root);

          await service.management?.state.set(projConfig.id, actionId, address.key, parsedVal as any, {
            namespace: address.namespace,
            ttl: ttlSec,
          });

          const displayKey = address.namespace ? `${address.namespace}:${address.key}` : address.key;
          writeStdout(`[OK] State '${displayKey}' updated in package '${projConfig.id}'`, context);
        },
        { localRoot: () => getTargetRoot(options.package, rawKey).root }
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

      await withService(
        options,
        context,
        async (service, resolved) => {
          const actionId = options.action || "";

          if (resolved.type === "remote") {
            const address = resolveStateAddress(rawKey, options, context);
            const deleted = await service.management?.state.delete(options.package || "", actionId, address.key, {
              namespace: address.namespace,
            });

            if (!deleted) {
              throw new ExecutionError(`State key '${rawKey}' not found on remote server`);
            }

            writeStdout(`[OK] State '${rawKey}' deleted on remote server`, context);
            return;
          }

          // 本地项目模式：getTargetRoot 会从键中剥离 pkg/ 前缀，寻址基于解耦后的裸键
          const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
          const address = resolveStateAddress(effectiveKey, options, context);
          const projConfig = loadProjectConfig(root);

          const deleted = await service.management?.state.delete(projConfig.id, actionId, address.key, {
            namespace: address.namespace,
          });
          if (!deleted) {
            throw new ExecutionError(`State key '${rawKey}' not found in package '${projConfig.id}'`);
          }
          writeStdout(`[OK] State '${rawKey}' deleted from package '${projConfig.id}'`, context);
        },
        { localRoot: () => getTargetRoot(options.package, rawKey).root }
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
        const { root } = getTargetRoot(options.package);
        const projConfig = loadProjectConfig(root);

        const count = (await service.management?.state.clear(projConfig.id, actionId, {
          namespace: options.namespace,
          all: Boolean(options.all),
        })) ?? 0;

        const scopeDesc = options.all
          ? "all namespaces"
          : `namespace '${options.namespace}'`;
        writeStdout(`[OK] Cleared ${count} state entry(s) in ${scopeDesc} for package '${projConfig.id}'`, context);
      },
      { localRoot: () => getTargetRoot(options.package).root });
    });
}
