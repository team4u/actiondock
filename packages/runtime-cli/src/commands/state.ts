import { existsSync } from "node:fs";
import {
  clearRemoteState,
  createStorage,
  deleteRemoteStateKey,
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
import type { RuntimeCliContext } from "../types";
import { getEffectiveOptions, getTargetRoot, resolveIntent } from "../utils";

/**
 * 注册 state 状态管理命令（get、set、delete、clear、keys、list）。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerStateCommands(program: Command, context?: RuntimeCliContext): void {
  const stateCmd = program
    .command("state")
    .description("Inspect and manage Shared State store");

  // 通用 state list / keys 实现
  const handleListKeys = async (prefix: string = "", rawOptions: any, cmd: any) => {
    const options = getEffectiveOptions(rawOptions, cmd);
    const effectiveIntent = resolveIntent(options.intent, prefix ? [prefix] : []);
    const shouldFallback = options.fallback !== false;

    // 1. 独立运行模式
    if (context?.standalone) {
      const sa = context.standalone;
      const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
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
              `${sa.packageId} (Standalone)`,
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

    // 2. 远端服务模式
    const target = resolveTarget({
      profile: options.profile,
      server: options.server,
      token: options.token,
    });

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

    // 3. 本地工程与链接包
    const targetRoot = options.package
      ? resolvePackageRoot(options.package)
      : findProjectRoot();

    if (options.package && !targetRoot) {
      throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
    }

    if (targetRoot) {
      const projConfig = loadProjectConfig(targetRoot);
      const storage = createStorage(projConfig.id, { projectRoot: targetRoot });
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
              `${projConfig.id} (${targetRoot})`,
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

    // 全局扫描所有链接的包
    const linkedList = listLinkedPackages();
    if (linkedList.length === 0) {
      renderResult([], {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () =>
          "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
        context,
      });
      return;
    }

    const aggregated: Array<{
      packageId: string;
      packageName: string;
      path: string;
      keys: string[];
      entries?: any[];
    }> = [];

    for (const pkg of linkedList) {
      if (!existsSync(pkg.path)) continue;
      try {
        const projConfig = loadProjectConfig(pkg.path);
        const storage = createStorage(projConfig.id, { projectRoot: pkg.path });

        if (options.detail && options.json) {
          const entries = await storage.listStateEntries({
            namespace: options.namespace,
            prefix: prefix || undefined,
          });
          storage.close();
          aggregated.push({
            packageId: pkg.id,
            packageName: pkg.name,
            path: pkg.path,
            keys: entries.map((e) => e.fullKey),
            entries,
          });
        } else {
          const keys = await storage.listStateKeys(
            options.namespace !== undefined ? options.namespace : null,
            prefix
          );
          storage.close();
          aggregated.push({
            packageId: pkg.id,
            packageName: pkg.name,
            path: pkg.path,
            keys,
          });
        }
      } catch {
        // 忽略失效链接
      }
    }

    let filteredPackages: typeof aggregated = [];
    if (!effectiveIntent) {
      filteredPackages = aggregated;
    } else {
      for (const pkg of aggregated) {
        const pkgMatches =
          filterWithFallbackInfo(
            [pkg],
            effectiveIntent,
            [(p) => p.packageId, (p) => p.packageName, (p) => p.path],
            false
          ).matchedCount > 0;

        if (pkgMatches) {
          filteredPackages.push(pkg);
        } else {
          const matchedKeys = filterWithFallbackInfo(
            pkg.keys,
            effectiveIntent,
            [(k) => k],
            false
          ).items;

          if (matchedKeys.length > 0) {
            filteredPackages.push({
              ...pkg,
              keys: matchedKeys,
            });
          }
        }
      }

      if (filteredPackages.length === 0 && shouldFallback) {
        filteredPackages = aggregated;
      }
    }

    renderResult(filteredPackages, {
      json: options.json,
      envelope: options.envelope,
      humanFormatter: () => {
        const lines: string[] = ["State Keys in Linked Packages:\n"];
        for (const pkg of filteredPackages) {
          lines.push(`- Package: ${pkg.packageId} (${pkg.path})`);
          if (pkg.keys.length === 0) {
            lines.push("    (no state keys found)");
          } else {
            for (const k of pkg.keys) {
              lines.push(`    - ${k}`);
            }
          }
        }
        return lines.join("\n");
      },
      context,
    });
  };

  // state list
  stateCmd
    .command("list [prefix]")
    .description("List state keys matching prefix, namespace, or intent pattern")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Filter by specific namespace")
    .option("-p, --profile <name>", "Query state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("-d, --detail", "Show detailed state entry objects")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(handleListKeys);

  // state keys 别名命令
  stateCmd
    .command("keys [prefix]")
    .description("List state keys (alias for 'ad state list')")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Filter by specific namespace")
    .option("-p, --profile <name>", "Query state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(handleListKeys);

  // state get
  stateCmd
    .command("get <key>")
    .description("Get a state value by key, namespace:key, or package/namespace:key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Target namespace")
    .option("-p, --profile <name>", "Query state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawKey: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey) {
        throw new ArgumentError("State key required for get");
      }

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        let val: unknown;
        let entryNs = options.namespace || "";

        if (options.namespace !== undefined) {
          val = await storage.getState(options.namespace, rawKey);
        } else {
          const entry = await storage.findState(rawKey);
          if (entry) {
            val = entry.value;
            entryNs = entry.namespace;
          }
        }
        storage.close();

        if (val === undefined) {
          throw new ExecutionError(`State key '${rawKey}' not found in ${sa.packageId}`);
        }

        const payload = {
          key: rawKey,
          packageId: sa.packageId,
          namespace: entryNs,
          value: val,
        };

        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => (val !== undefined ? JSON.stringify(val, null, 2) : "undefined"),
          context,
        });
        return;
      }

      // 2. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        const res = await getRemoteStateKey(target.serverUrl!, rawKey, target.token, {
          package: options.package,
          namespace: options.namespace,
        });
        renderResult(res, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => (res.value !== undefined ? JSON.stringify(res.value, null, 2) : "undefined"),
          context,
        });
        return;
      }

      // 3. 本地存储模式
      const { root, key } = getTargetRoot(options.package, rawKey);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, { projectRoot: root });

      let val: unknown;
      let entryNamespace = options.namespace || "";

      if (options.namespace !== undefined) {
        val = await storage.getState(options.namespace, key);
      } else {
        const entry = await storage.findState(key);
        if (entry) {
          val = entry.value;
          entryNamespace = entry.namespace;
        }
      }
      storage.close();

      if (val === undefined) {
        throw new ExecutionError(`State key '${key}' not found in ${projConfig.id}`);
      }

      const payload = {
        key,
        packageId: projConfig.id,
        namespace: entryNamespace,
        value: val,
      };

      renderResult(payload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => (val !== undefined ? JSON.stringify(val, null, 2) : "undefined"),
        context,
      });
    });

  // state set
  stateCmd
    .command("set <key> <value>")
    .description("Set a state value by key, namespace:key, or package/namespace:key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Target namespace")
    .option("-p, --profile <name>", "Set state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--ttl <seconds>", "Time to live in seconds", (v) => parseInt(v, 10))
    .action(async (rawKey: string, rawValue: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey || rawValue === undefined) {
        throw new ArgumentError("Both key and value are required for state set");
      }

      let parsed: unknown = rawValue;
      try {
        parsed = JSON.parse(rawValue);
      } catch {
        parsed = rawValue;
      }

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        let ns = options.namespace || "";
        let actualKey = rawKey;

        if (options.namespace === undefined && rawKey.includes(":")) {
          const colonIdx = rawKey.indexOf(":");
          ns = rawKey.slice(0, colonIdx);
          actualKey = rawKey.slice(colonIdx + 1);
        }

        await storage.setState(ns, actualKey, parsed, options.ttl);
        storage.close();

        const displayKey = ns ? `${ns}:${actualKey}` : actualKey;
        writeStdout(
          `[OK] State '${displayKey}' set to ${JSON.stringify(parsed)}${options.ttl ? ` (TTL: ${options.ttl}s)` : ""} in ${sa.packageId}`,
          context
        );
        return;
      }

      // 2. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        await setRemoteStateKey(target.serverUrl!, rawKey, parsed, target.token, {
          package: options.package,
          namespace: options.namespace,
          ttl: options.ttl,
        });
        writeStdout(`[OK] State '${rawKey}' updated on remote server ${target.serverUrl}`, context);
        return;
      }

      // 3. 本地存储模式
      const { root, key } = getTargetRoot(options.package, rawKey);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, { projectRoot: root });

      let ns = "";
      let actualKey = key;

      if (options.namespace !== undefined) {
        ns = options.namespace;
        actualKey = key;
      } else if (key.includes(":")) {
        const colonIdx = key.indexOf(":");
        ns = key.slice(0, colonIdx);
        actualKey = key.slice(colonIdx + 1);
      }

      await storage.setState(ns, actualKey, parsed, options.ttl);
      storage.close();

      const displayKey = ns ? `${ns}:${actualKey}` : actualKey;
      writeStdout(
        `[OK] State '${displayKey}' set to ${JSON.stringify(parsed)}${options.ttl ? ` (TTL: ${options.ttl}s)` : ""} in ${projConfig.id}`,
        context
      );
    });

  // state delete
  stateCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete a state value by key, namespace:key, or package/namespace:key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Target namespace")
    .option("-p, --profile <name>", "Delete state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--silent", "Do not fail if key is not found")
    .action(async (rawKey: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!rawKey) {
        throw new ArgumentError("State key required for delete");
      }

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        const deleted = await storage.deleteStateSmart(rawKey, options.namespace);
        storage.close();

        if (deleted) {
          writeStdout(`[OK] State '${rawKey}' deleted from ${sa.packageId}`, context);
        } else if (!options.silent) {
          throw new ExecutionError(`State key '${rawKey}' not found in ${sa.packageId}`);
        }
        return;
      }

      // 2. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        await deleteRemoteStateKey(target.serverUrl!, rawKey, target.token, {
          package: options.package,
          namespace: options.namespace,
        });
        writeStdout(`[OK] State '${rawKey}' deleted from remote server ${target.serverUrl}`, context);
        return;
      }

      // 3. 本地存储模式
      const { root, key } = getTargetRoot(options.package, rawKey);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, { projectRoot: root });
      const deleted = await storage.deleteStateSmart(key, options.namespace);
      storage.close();

      if (deleted) {
        writeStdout(`[OK] State '${key}' deleted from ${projConfig.id}`, context);
      } else if (!options.silent) {
        throw new ExecutionError(`State key '${key}' not found in ${projConfig.id}`);
      }
    });

  // state clear
  stateCmd
    .command("clear [prefix]")
    .alias("clean")
    .description("Clear state entries by namespace, prefix, or all")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Target namespace to clear")
    .option("-p, --profile <name>", "Clear state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-a, --all", "Clear all state entries across all namespaces in this package")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (prefix: string = "", rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        const count = await storage.clearState({
          namespace: options.namespace,
          all: options.all,
          prefix: prefix || undefined,
        });
        storage.close();

        const payload = { ok: true, clearedCount: count };
        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => `[OK] Cleared ${count} state entry(s) from ${sa.packageId}`,
          context,
        });
        return;
      }

      // 2. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        const res = await clearRemoteState(target.serverUrl!, target.token, {
          package: options.package,
          namespace: options.namespace,
          prefix,
          all: Boolean(options.all),
        });

        renderResult(res, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            `[OK] Cleared ${res.clearedCount} state entry(s) on remote server ${target.serverUrl}`,
          context,
        });
        return;
      }

      // 3. 本地存储模式
      const { root } = getTargetRoot(options.package);
      const projConfig = loadProjectConfig(root);
      const storage = createStorage(projConfig.id, { projectRoot: root });
      const count = await storage.clearState({
        namespace: options.namespace,
        all: options.all,
        prefix: prefix || undefined,
      });
      storage.close();

      const scopeDesc = options.all
        ? "all namespaces"
        : options.namespace
        ? `namespace '${options.namespace}'`
        : prefix
        ? `prefix '${prefix}'`
        : "root namespace";

      const payload = { ok: true, clearedCount: count };
      renderResult(payload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => `[OK] Cleared ${count} state entry(s) (${scopeDesc}) from ${projConfig.id}`,
        context,
      });
    });
}
