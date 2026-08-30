import {
  createStorage,
  filterWithFallbackInfo,
  findProjectRoot,
  loadProjectConfig,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

export function registerStateCommands(program: Command): void {
  const stateCmd = program
    .command("state")
    .description("Inspect and manage Shared State store");

  // state list
  stateCmd
    .command("list [prefix]")
    .description("List state keys matching prefix or intent pattern")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action(async (prefix = "", options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
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
            `State keys for ${projConfig.id}${prefix ? ` (filter: ${prefix})` : ""}:\n`
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
    .option("--json", "Output as JSON")
    .action(async (key, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
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
    .option("--ttl <seconds>", "Time to live in seconds", (v) => parseInt(v, 10))
    .action(async (key, rawValue, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });

        let parsed: unknown = rawValue;
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          parsed = rawValue;
        }

        const ttl =
          options.ttl !== undefined && !isNaN(options.ttl)
            ? options.ttl
            : undefined;

        await storage.setState("", key, parsed, ttl);
        storage.close();

        const meta = ttl ? ` (ttl: ${ttl}s)` : "";
        console.log(
          `[OK] State '${key}' set to ${JSON.stringify(parsed)}${meta}`
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
    .description("Delete a state key")
    .action(async (key) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        await storage.deleteState("", key);
        storage.close();
        console.log(`[OK] State '${key}' deleted`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
