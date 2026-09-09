import { existsSync } from "node:fs";
import {
  clearRemoteState,
  createStorage,
  decodeStateKey,
  deleteRemoteStateKey,
  encodeStateKey,
  fetchRemoteStateList,
  filterWithFallbackInfo,
  findProjectRoot,
  getRemoteStateKey,
  listLinkedPackages,
  loadProjectConfig,
  resolvePackageRoot,
  resolveTarget,
  setRemoteStateKey,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderResult, renderStateList, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, getTargetRoot, resolveIntent } from "../utils";

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

  // 通用 state list / keys 实现
  const handleListKeys = async (prefix: string = "", rawOptions: any, cmd: any) => {
    const options = getEffectiveOptions(rawOptions, cmd);
    const effectiveIntent = resolveIntent(options.intent, prefix ? [prefix] : []);
    const shouldFallback = options.fallback !== false;

    // 1. 远端服务模式
    const target = resolveTarget({
      profile: options.profile,
      server: options.server,
      token: options.token,
    }, context?.customHome);

    if (target.type === "remote") {
      const res = await fetchRemoteStateList(target.serverUrl!, target.token, {
        package: options.package,
        namespace: options.namespace,
        prefix,
      });

      renderResult(res.keys, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () =>
          renderStateList(
            res.keys,
            `Remote Server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}`,
            false,
            effectiveIntent
          ),
        context,
      });
      return;
    }

    // 2. 本地工程与链接包模式
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
      const projConfig = loadProjectConfig(targetRoot);
      const storage = createStorage(projConfig.id, {
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
      });
      try {
        if (options.detail && options.json) {
          const entries = await storage.listStateEntries({
            namespace: options.namespace,
            prefix: prefix || undefined,
          });
          const filterRes = filterWithFallbackInfo(
            entries,
            effectiveIntent,
            [(e) => e.fullKey, (e) => e.key, (e) => e.namespace],
            shouldFallback
          );
          renderResult(filterRes.items, {
            json: true,
            envelope: options.envelope,
            context,
          });
          return;
        }

        const allKeys = await storage.listStateKeys(
          options.namespace !== undefined ? options.namespace : null,
          prefix
        );

        const filterRes = filterWithFallbackInfo(allKeys, effectiveIntent, [(k) => k], shouldFallback);

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderStateList(
              filterRes.items,
              `${projConfig.name} (${projConfig.id})`,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      } finally {
        storage.close();
      }
    }

    // 扫描所有链接的包状态
    const linked = listLinkedPackages();
    if (linked.length === 0) {
      renderResult(
        [],
        {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => "No ActionDock project in current directory, and no packages linked.",
          context,
        }
      );
      return;
    }

    const aggregatedKeys: string[] = [];
    for (const pkg of linked) {
      if (!existsSync(pkg.path)) continue;
      try {
        const config = loadProjectConfig(pkg.path);
        const storage = createStorage(config.id, {
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
        });
        const keys = await storage.listStateKeys(
          options.namespace !== undefined ? options.namespace : null,
          prefix
        );
        storage.close();
        for (const k of keys) {
          aggregatedKeys.push(`${config.id}/${k}`);
        }
      } catch {}
    }

    const filterRes = filterWithFallbackInfo(
      aggregatedKeys,
      effectiveIntent,
      [(k) => k],
      shouldFallback
    );

    renderResult(filterRes.items, {
      json: options.json,
      envelope: options.envelope,
      humanFormatter: () =>
        renderStateList(
          filterRes.items,
          "Linked Packages State Store",
          filterRes.isFallback,
          effectiveIntent
        ),
      context,
    });
  };

  // state list
  stateCmd
    .command("list [prefix]")
    .description("List state keys in current project or linked packages")
    .option("-P, --package <id>", "Target package ID or path")
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
    .description("Get state value for key (supports composite key 'ns:key' or -n flag)")
    .option("-P, --package <id>", "Target package ID or path")
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

      // 1. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const decoded = decodeStateKey(rawKey);
        const effectiveNamespace = options.namespace || (decoded.namespace || undefined);
        const actualKey = options.namespace ? rawKey : decoded.key;

        const val = await getRemoteStateKey(target.serverUrl!, actualKey, target.token, {
          package: options.package,
          namespace: effectiveNamespace,
        });

        if (val === undefined) {
          renderResult(
            { key: rawKey, value: undefined },
            {
              json: options.json,
              envelope: options.envelope,
              humanFormatter: () => "",
              context,
            }
          );
          throw new ExecutionError(`State key '${rawKey}' not found on remote server`);
        }

        renderResult(
          { key: rawKey, value: val, namespace: effectiveNamespace },
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)),
            context,
          }
        );
        return;
      }

      // 2. 本地项目模式
      const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, {
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
      });

      try {
        let val: unknown;
        let matchedNamespace: string | undefined = options.namespace;

        if (options.namespace !== undefined) {
          val = await storage.getState(options.namespace, effectiveKey);
        } else {
          const res = await storage.findState(effectiveKey);
          val = res?.value;
          matchedNamespace = res?.namespace;
        }

        if (val === undefined) {
          renderResult(
            { key: rawKey, value: undefined },
            {
              json: options.json,
              envelope: options.envelope,
              humanFormatter: () => "",
              context,
            }
          );
          throw new ExecutionError(`State key '${rawKey}' not found in package '${projConfig.id}'`);
        }

        renderResult(
          { key: rawKey, value: val, namespace: matchedNamespace },
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)),
            context,
          }
        );
      } finally {
        storage.close();
      }
    });

  // state set <key> <value>
  stateCmd
    .command("set <key> <value>")
    .description("Set state key-value (supports JSON value, composite 'ns:key', and --ttl)")
    .option("-P, --package <id>", "Target package ID or path")
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

      // 1. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const decoded = decodeStateKey(rawKey);
        const effectiveNamespace = options.namespace || (decoded.namespace || undefined);
        const actualKey = options.namespace ? rawKey : decoded.key;

        await setRemoteStateKey(target.serverUrl!, actualKey, parsedVal, target.token, {
          package: options.package,
          namespace: effectiveNamespace,
          ttl: ttlSec,
        });

        writeStdout(`[OK] State '${rawKey}' updated on remote server`, context);
        return;
      }

      // 2. 本地项目模式
      const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, {
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
      });

      try {
        let actualNamespace = options.namespace || "";
        let finalKey = effectiveKey;

        if (options.namespace === undefined && effectiveKey.includes(":")) {
          const decoded = decodeStateKey(effectiveKey);
          actualNamespace = decoded.namespace;
          finalKey = decoded.key;
        }

        await storage.setState(actualNamespace, finalKey, parsedVal, ttlSec);

        const displayKey = actualNamespace ? `${actualNamespace}:${finalKey}` : finalKey;
        writeStdout(`[OK] State '${displayKey}' updated in package '${projConfig.id}'`, context);
      } finally {
        storage.close();
      }
    });

  // state delete <key>
  stateCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete state key entry")
    .option("-P, --package <id>", "Target package ID or path")
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

      // 1. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const decoded = decodeStateKey(rawKey);
        const effectiveNamespace = options.namespace || (decoded.namespace || undefined);
        const actualKey = options.namespace ? rawKey : decoded.key;

        const deleted = await deleteRemoteStateKey(target.serverUrl!, actualKey, target.token, {
          package: options.package,
          namespace: effectiveNamespace,
        });

        if (!deleted) {
          throw new ExecutionError(`State key '${rawKey}' not found on remote server`);
        }

        writeStdout(`[OK] State '${rawKey}' deleted on remote server`, context);
        return;
      }

      // 2. 本地项目模式
      const { root, key: effectiveKey } = getTargetRoot(options.package, rawKey);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, {
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
      });

      try {
        const deleted = await storage.deleteStateSmart(effectiveKey, options.namespace);
        if (!deleted) {
          throw new ExecutionError(`State key '${rawKey}' not found in package '${projConfig.id}'`);
        }
        writeStdout(`[OK] State '${rawKey}' deleted from package '${projConfig.id}'`, context);
      } finally {
        storage.close();
      }
    });

  // state clear
  stateCmd
    .command("clear")
    .alias("clean")
    .description("Clear state entries (supports namespace cleanup or global wipe via --all)")
    .option("-P, --package <id>", "Target package ID or path")
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

      // 1. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const count = await clearRemoteState(target.serverUrl!, target.token, {
          package: options.package,
          namespace: options.namespace,
          all: Boolean(options.all),
        });
        writeStdout(`[OK] Cleared ${count} state entry(s) on remote server`, context);
        return;
      }

      // 2. 本地项目模式
      const { root } = getTargetRoot(options.package);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, {
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
      });

      try {
        const count = await storage.clearState({
          namespace: options.namespace,
          all: Boolean(options.all),
        });

        const scopeDesc = options.all
          ? "all namespaces"
          : `namespace '${options.namespace}'`;
        writeStdout(`[OK] Cleared ${count} state entry(s) in ${scopeDesc} for package '${projConfig.id}'`, context);
      } finally {
        storage.close();
      }
    });
}
