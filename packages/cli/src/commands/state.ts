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
import { resolveIntent } from "../utils/filter";

function getTargetRoot(packageOption?: string, keyHint?: string): { root: string; key: string } {
  let targetPackage = packageOption;
  let effectiveKey = keyHint || "";

  if (!targetPackage && keyHint) {
    if (keyHint.includes("/")) {
      const slashIdx = keyHint.indexOf("/");
      targetPackage = keyHint.slice(0, slashIdx);
      effectiveKey = keyHint.slice(slashIdx + 1);
    }
  }

  const root = resolvePackageRoot(targetPackage);
  if (!root) {
    if (targetPackage) {
      console.error(`Error: Package '${targetPackage}' not found in linked packages or path`);
    } else {
      console.error(
        "Error: Not in an ActionDock project (actiondock.json not found).\nPlease specify -P, --package <id> or cd into a project directory."
      );
    }
    process.exit(1);
  }
  return { root, key: effectiveKey };
}

export function registerStateCommands(program: Command): void {
  const stateCmd = program
    .command("state")
    .description("Inspect and manage Shared State store");

  // state list
  stateCmd
    .command("list [prefix]")
    .description("List state keys matching prefix, namespace, or intent pattern (in current project or linked packages)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Filter by specific namespace")
    .option("-p, --profile <name>", "Query state on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("-d, --detail", "Show detailed state entry objects (including namespace, expiration, update time)")
    .option("--json", "Output as JSON")
    .action(async (prefix = "", options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, prefix ? [prefix] : []);
        const shouldFallback = options.fallback !== false;

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
          if (options.json) {
            console.log(JSON.stringify(res.keys, null, 2));
            return;
          }
          console.log(
            `State keys on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""} (${res.keys.length}):\n`
          );
          for (const k of res.keys) {
            console.log(`  - ${k}`);
          }
          return;
        }

        const targetRoot = options.package
          ? resolvePackageRoot(options.package)
          : findProjectRoot();

        if (options.package && !targetRoot) {
          console.error(`Error: Package '${options.package}' not found in linked packages or path`);
          process.exit(1);
        }

        if (targetRoot) {
          const projConfig = loadProjectConfig(targetRoot);
          const storage = createStorage(projConfig.id, { projectRoot: targetRoot });

          if (options.detail && options.json) {
            const entries = await storage.listStateEntries({
              namespace: options.namespace,
              prefix: prefix || undefined,
            });
            storage.close();

            const filterRes = filterWithFallbackInfo(
              entries,
              effectiveIntent,
              [(e) => e.fullKey, (e) => e.key, (e) => e.namespace],
              shouldFallback
            );

            console.log(JSON.stringify(filterRes.items, null, 2));
            return;
          }

          const allKeys = await storage.listStateKeys(
            options.namespace !== undefined ? options.namespace : null,
            prefix
          );
          storage.close();

          const filterRes = filterWithFallbackInfo(
            allKeys,
            effectiveIntent,
            [(k) => k],
            shouldFallback
          );

          if (options.json) {
            console.log(JSON.stringify(filterRes.items, null, 2));
          } else {
            const nsDesc = options.namespace ? ` [namespace: ${options.namespace}]` : "";
            const filterDesc = prefix ? ` (filter: ${prefix})` : "";
            console.log(`State keys for ${projConfig.id} (${targetRoot})${nsDesc}${filterDesc}:\n`);
            if (filterRes.isFallback && effectiveIntent) {
              console.log(`(No state keys matched intent '${effectiveIntent}', showing all keys)\n`);
            }
            if (filterRes.items.length === 0) {
              console.log("  (no state keys found)\n");
            } else {
              for (const k of filterRes.items) {
                console.log(`  - ${k}`);
              }
            }
          }
          return;
        }

        // Outside project: list state keys across all linked packages
        const linkedList = listLinkedPackages();
        if (linkedList.length === 0) {
          console.log("No ActionDock project in current directory, and no packages linked.");
          console.log("Run 'ad link' inside an Action package to register it.");
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
            // Ignore broken linked package
          }
        }

        let filteredPackages: typeof aggregated = [];
        if (!effectiveIntent) {
          filteredPackages = aggregated;
        } else {
          for (const pkg of aggregated) {
            const pkgMatches = filterWithFallbackInfo(
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

        if (options.json) {
          console.log(JSON.stringify(filteredPackages, null, 2));
        } else {
          console.log("State Keys in Linked Packages:\n");
          for (const pkg of filteredPackages) {
            console.log(`* Package: ${pkg.packageId} (${pkg.path})`);
            if (pkg.keys.length === 0) {
              console.log("    (no state keys found)");
            } else {
              for (const k of pkg.keys) {
                console.log(`    - ${k}`);
              }
            }
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

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
    .action(async (rawKey, options) => {
      try {
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
          if (options.json) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(res.value !== undefined ? JSON.stringify(res.value, null, 2) : "undefined");
          }
          return;
        }

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
          console.error(`Error: State key '${key}' not found in ${projConfig.id}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                key,
                packageId: projConfig.id,
                namespace: entryNamespace,
                value: val,
              },
              null,
              2
            )
          );
        } else {
          console.log(val !== undefined ? JSON.stringify(val, null, 2) : "undefined");
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
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
    .action(async (rawKey, rawValue, options) => {
      try {
        let parsed: unknown = rawValue;
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          parsed = rawValue;
        }

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
          console.log(`[OK] State '${rawKey}' updated on remote server ${target.serverUrl}`);
          return;
        }

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
        console.log(
          `[OK] State '${displayKey}' set to ${JSON.stringify(parsed)}${options.ttl ? ` (TTL: ${options.ttl}s)` : ""} in ${projConfig.id}`
        );
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
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
    .option("--silent", "Do not exit with error if key is not found")
    .action(async (rawKey, options) => {
      try {
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
          console.log(`[OK] State '${rawKey}' deleted from remote server ${target.serverUrl}`);
          return;
        }

        const { root, key } = getTargetRoot(options.package, rawKey);
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const deleted = await storage.deleteStateSmart(key, options.namespace);
        storage.close();

        if (deleted) {
          console.log(`[OK] State '${key}' deleted from ${projConfig.id}`);
        } else {
          if (!options.silent) {
            console.error(`Error: State key '${key}' not found in ${projConfig.id}`);
            process.exit(1);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
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
    .action(async (prefix = "", options) => {
      try {
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
          console.log(`[OK] Cleared ${res.clearedCount} state entry(s) on remote server ${target.serverUrl}`);
          return;
        }

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
        console.log(`[OK] Cleared ${count} state entry(s) (${scopeDesc}) from ${projConfig.id}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}

