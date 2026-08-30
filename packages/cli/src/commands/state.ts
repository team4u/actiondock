import { createStorage, findProjectRoot, loadProjectConfig } from "@actiondock/core";
import { Command } from "commander";

export function registerStateCommands(program: Command): void {
  const stateCmd = program
    .command("state")
    .description("Inspect and manage Shared State store");

  // state list
  stateCmd
    .command("list [prefix]")
    .description("List state keys matching prefix")
    .option("--json", "Output as JSON")
    .action(async (prefix = "", options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const keys = await storage.listStateKeys("", prefix);
        storage.close();

        if (options.json) {
          console.log(JSON.stringify(keys, null, 2));
        } else {
          console.log(`State keys for ${projConfig.id}${prefix ? ` (prefix: ${prefix})` : ""}:\n`);
          for (const k of keys) {
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
