import {
  decodeStateKey,
  findProjectRoot,
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderResult, renderStateList, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, getTargetRoot, resolveIntent, withTarget } from "../utils";
import {
  renderLinkedPackagesStateList,
  renderProjectScopedStateList,
} from "./state-list";

/**
 * 注册 state 状态管理命令（get、set、delete、clear、keys、list）。
 *
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerStateCommands(program: Command, context?: CliContext): void {
  const stateCmd = program
    .command("state")
    .description("Inspect and manage Shared State store");

  // state list / keys 共享实现（远端、本地项目、链接包聚合三分支）
  const handleListKeys = async (prefix: string = "", rawOptions: any, cmd: any) => {
    const options = getEffectiveOptions(rawOptions, cmd);
    const effectiveIntent = resolveIntent(options.intent, prefix ? [prefix] : []);
    const shouldFallback = options.fallback !== false;

    await withTarget(options, context, async (target, resolved) => {
      const actionId = options.action || "";

      // 远端服务模式：直接列举远端包作用域键
      if (resolved.type === "remote") {
        const keys = await target.listStateKeys(options.package || "", actionId, {
          namespace: options.namespace,
          prefix,
        });

        renderResult(keys, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderStateList(
              keys,
              `Remote Server ${resolved.serverUrl}${resolved.profileName ? ` (Profile: ${resolved.profileName})` : ""}`,
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
          throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
        }
      } else {
        targetRoot = findProjectRoot();
      }

      if (targetRoot) {
        await renderProjectScopedStateList({
          target,
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
        target,
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
  stateCmd
    .command("list [prefix]")
    .description("List state keys in current project or linked packages")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-a, --action <id>", "Action identifier scope")
    .option("-n, --namespace <ns>", "Filter keys under specific namespace (omit to list all namespaces)")
    .option("-p, --profile <name>", "Query state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--detail", "Include metadata (ttl, expiresAt, size, updatedAt) in JSON output")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(handleListKeys);

  // state keys 别名
  stateCmd
    .command("keys [prefix]")
    .description("Alias for 'ad state list [prefix]'")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-a, --action <id>", "Action identifier scope")
    .option("-n, --namespace <ns>", "Filter keys under specific namespace")
    .option("-p, --profile <name>", "Query state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter")
    .option("--detail", "Include metadata in JSON output")
    .option("--no-fallback", "Disable fallback")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(handleListKeys);

  // state get <key>
  stateCmd
    .command("get <key>")
    .description("Get state value by key (supports composite 'ns:key' and detail mode)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-a, --action <id>", "Action identifier scope")
    .option("-n, --namespace <ns>", "Explicit namespace scope for key")
    .option("-p, --profile <name>", "Query state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawKey: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey) {
        throw new ArgumentError("State key is required");
      }

      await withTarget(
        options,
        context,
        async (target, resolved) => {
          const actionId = options.action || "";

          if (resolved.type === "remote") {
            const decoded = decodeStateKey(rawKey);
            const effectiveNamespace = options.namespace || (decoded.namespace || undefined);
            const actualKey = options.namespace ? rawKey : decoded.key;

            const entry = await target.getState(options.package || "", actionId, actualKey, {
              namespace: effectiveNamespace,
              detail: true,
            });

            if (entry === undefined || (entry as any).value === undefined) {
              throw new ExecutionError(`State key '${rawKey}' not found on remote server`);
            }

            const val = (entry as any).value;
            renderResult(
              { key: rawKey, value: val, namespace: (entry as any).namespace || effectiveNamespace },
              {
                json: options.json,
                envelope: options.envelope,
                humanFormatter: () => (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)),
                context,
              }
            );
            return;
          }

          // 本地项目模式
          const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
          const projConfig = loadProjectConfig(root);

          const entry = await target.getState(projConfig.id, actionId, effectiveKey, {
            namespace: options.namespace,
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
              envelope: options.envelope,
              humanFormatter: () => (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)),
              context,
            }
          );
        },
        { localRoot: () => getTargetRoot(options.package, rawKey).root }
      );
    });

  // state set <key> <value>
  stateCmd
    .command("set <key> <value>")
    .description("Set state key-value (supports JSON value, composite 'ns:key', and --ttl)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-a, --action <id>", "Action identifier scope")
    .option("-n, --namespace <ns>", "Explicit namespace scope for key")
    .option("--ttl <seconds>", "Time-To-Live expiration in seconds")
    .option("-p, --profile <name>", "Set state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
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

      await withTarget(
        options,
        context,
        async (target, resolved) => {
          const actionId = options.action || "";

          if (resolved.type === "remote") {
            const decoded = decodeStateKey(rawKey);
            const effectiveNamespace = options.namespace || (decoded.namespace || undefined);
            const actualKey = options.namespace ? rawKey : decoded.key;

            await target.setState(options.package || "", actionId, actualKey, parsedVal as any, {
              namespace: effectiveNamespace,
              ttl: ttlSec,
            });

            writeStdout(`[OK] State '${rawKey}' updated on remote server`, context);
            return;
          }

          // 本地项目模式
          const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
          const projConfig = loadProjectConfig(root);

          let actualNamespace = options.namespace;
          let finalKey = effectiveKey;

          if (options.namespace === undefined && effectiveKey.includes(":")) {
            const decoded = decodeStateKey(effectiveKey);
            actualNamespace = decoded.namespace;
            finalKey = decoded.key;
          }

          await target.setState(projConfig.id, actionId, finalKey, parsedVal as any, {
            namespace: actualNamespace,
            ttl: ttlSec,
          });

          const displayKey = actualNamespace ? `${actualNamespace}:${finalKey}` : finalKey;
          writeStdout(`[OK] State '${displayKey}' updated in package '${projConfig.id}'`, context);
        },
        { localRoot: () => getTargetRoot(options.package, rawKey).root }
      );
    });

  // state delete <key>
  stateCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete state key entry")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-a, --action <id>", "Action identifier scope")
    .option("-n, --namespace <ns>", "Explicit namespace scope for key")
    .option("-p, --profile <name>", "Delete state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawKey: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey) {
        throw new ArgumentError("State key is required");
      }

      await withTarget(
        options,
        context,
        async (target, resolved) => {
          const actionId = options.action || "";

          if (resolved.type === "remote") {
            const decoded = decodeStateKey(rawKey);
            const effectiveNamespace = options.namespace || (decoded.namespace || undefined);
            const actualKey = options.namespace ? rawKey : decoded.key;

            const deleted = await target.deleteState(options.package || "", actionId, actualKey, {
              namespace: effectiveNamespace,
            });

            if (!deleted) {
              throw new ExecutionError(`State key '${rawKey}' not found on remote server`);
            }

            writeStdout(`[OK] State '${rawKey}' deleted on remote server`, context);
            return;
          }

          // 本地项目模式
          const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
          const projConfig = loadProjectConfig(root);

          const deleted = await target.deleteState(projConfig.id, actionId, effectiveKey, {
            namespace: options.namespace,
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
  stateCmd
    .command("clear")
    .alias("clean")
    .description("Clear state entries (supports namespace cleanup or global wipe via --all)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--action <id>", "Action identifier scope")
    .option("-n, --namespace <ns>", "Target namespace to clear (required unless --all is specified)")
    .option("-a, --all", "Dangerously clear all state namespaces for the package")
    .option("-p, --profile <name>", "Clear state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!options.all && options.namespace === undefined) {
        throw new ArgumentError(
          "Must specify either -n/--namespace <name> to clear specific namespace, or --all to clear entire package state store."
        );
      }

      await withTarget(options, context, async (target, resolved) => {
        const actionId = options.action || "";

        if (resolved.type === "remote") {
          const count = await target.clearState(options.package || "", actionId, {
            namespace: options.namespace,
            all: Boolean(options.all),
          });
          writeStdout(`[OK] Cleared ${count} state entry(s) on remote server`, context);
          return;
        }

        // 本地项目模式
        const { root } = getTargetRoot(options.package);
        const projConfig = loadProjectConfig(root);

        const count = await target.clearState(projConfig.id, actionId, {
          namespace: options.namespace,
          all: Boolean(options.all),
        });

        const scopeDesc = options.all
          ? "all namespaces"
          : `namespace '${options.namespace}'`;
        writeStdout(`[OK] Cleared ${count} state entry(s) in ${scopeDesc} for package '${projConfig.id}'`, context);
      },
      { localRoot: () => getTargetRoot(options.package).root });
    });
}

