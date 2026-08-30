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
    .description("List state keys matching prefix or intent pattern")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action(async (prefix = "", options) => {
      const root = getTargetRoot(options.package);
      try {
        const effectiveIntent = resolveIntent(options.intent, prefix ? [prefix] : []);
        const shouldFallback = options.fallback !== false;

        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const allKeys = await storage.listStateKeys("");
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
          console.log(
            `State keys for ${projConfig.id} (${root})${prefix ? ` (filter: ${prefix})` : ""}:\n`
          );
          if (filterRes.isFallback && effectiveIntent) {
            console.log(`(No state keys matched intent '${effectiveIntent}', showing all keys)\n`);
          }
          for (const k of filterRes.items) {
            console.log(`  - ${k}`);
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
    .description("Get a state value by key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--json", "Output as JSON")
    .action(async (key, options) => {
      const root = getTargetRoot(options.package);
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const val = await storage.getState("", key);
        storage.close();

        if (options.json) {
          console.log(JSON.stringify({ key, value: val }, null, 2));
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
    .description("Set a state value by key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--ttl <seconds>", "Time to live in seconds", (v) => parseInt(v, 10))
    .action(async (key, rawValue, options) => {
      const root = getTargetRoot(options.package);
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });

        let parsed: unknown = rawValue;
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          parsed = rawValue;
        }

        await storage.setState("", key, parsed, options.ttl);
        storage.close();
        console.log(
          `[OK] State '${key}' set to ${JSON.stringify(parsed)}${options.ttl ? ` (TTL: ${options.ttl}s)` : ""} in ${projConfig.id}`
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
    .description("Delete a state value from local database")
    .option("-P, --package <id>", "Target package ID or path")
    .action(async (key, options) => {
      const root = getTargetRoot(options.package);
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        await storage.deleteState("", key);
        storage.close();
        console.log(`[OK] State '${key}' deleted from ${projConfig.id}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
