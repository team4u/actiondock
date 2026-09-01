import {
  createStorage,
  filterWithFallbackInfo,
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

function getTargetRoot(packageOption?: string): string {
  const root = resolvePackageRoot(packageOption);
  if (!root) {
    if (packageOption) {
      console.error(`Error: Package '${packageOption}' not found in linked packages or path`);
    } else {
      console.error(
        "Error: Not in an ActionDock project (actiondock.json not found).\nPlease cd into the project directory (e.g. /root/code/sui-tools) or specify -P, --package <id>"
      );
    }
    process.exit(1);
  }
  return root;
}

export function registerStateCommands(program: Command): void {
  const stateCmd = program
    .command("state")
    .description("Inspect and manage Shared State store");

  // state list
  stateCmd
    .command("list [prefix]")
    .description("List state keys matching prefix, namespace, or intent pattern")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Filter by specific namespace")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("-d, --detail", "Show detailed state entry objects (including namespace, expiration, update time)")
    .option("--json", "Output as JSON")
    .action(async (prefix = "", options) => {
      const root = getTargetRoot(options.package);
      try {
        const effectiveIntent = resolveIntent(options.intent, prefix ? [prefix] : []);
        const shouldFallback = options.fallback !== false;

        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });

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
          console.log(`State keys for ${projConfig.id} (${root})${nsDesc}${filterDesc}:\n`);
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
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // state get
  stateCmd
    .command("get <key>")
    .description("Get a state value by key or namespace:key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Target namespace")
    .option("--json", "Output as JSON")
    .action(async (key, options) => {
      const root = getTargetRoot(options.package);
      try {
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

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                key,
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
    .description("Set a state value by key or namespace:key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Target namespace")
    .option("--ttl <seconds>", "Time to live in seconds", (v) => parseInt(v, 10))
    .action(async (key, rawValue, options) => {
      const root = getTargetRoot(options.package);
      try {
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

        let parsed: unknown = rawValue;
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          parsed = rawValue;
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
    .description("Delete a state value by key or namespace:key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-n, --namespace <ns>", "Target namespace")
    .option("--silent", "Do not exit with error if key is not found")
    .action(async (key, options) => {
      const root = getTargetRoot(options.package);
      try {
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
    .option("-a, --all", "Clear all state entries across all namespaces in this package")
    .action(async (prefix = "", options) => {
      const root = getTargetRoot(options.package);
      try {
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
