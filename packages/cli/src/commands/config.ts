import { createStorage, findProjectRoot, loadProjectConfig } from "@actiondock/core";
import { Command } from "commander";

export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage project runtime configuration store");

  // config list
  configCmd
    .command("list")
    .description("List all configuration entries in local database")
    .option("--json", "Output as JSON")
    .action((options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const stored = storage.listConfig();

        // Merge with declared defaults for display
        const declared = projConfig.config || {};
        const allKeys = new Set([...Object.keys(declared), ...Object.keys(stored)]);

        const list = Array.from(allKeys).map((k) => ({
          key: k,
          value: stored[k] !== undefined ? stored[k] : declared[k]?.default,
          source: stored[k] !== undefined ? "database" : "default",
          description: declared[k]?.description || "",
        }));

        storage.close();

        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          console.log(`Configuration for ${projConfig.id}:\n`);
          for (const item of list) {
            const valStr = JSON.stringify(item.value);
            console.log(`  ${item.key.padEnd(24)} = ${valStr} (${item.source})`);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // config get
  configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .option("--json", "Output as JSON")
    .action((key, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const val = storage.getConfig(key);
        const fallback = projConfig.config?.[key]?.default;
        const effective = val !== undefined ? val : fallback;
        storage.close();

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                key,
                value: effective,
                source: val !== undefined ? "database" : fallback !== undefined ? "default" : "undefined",
              },
              null,
              2
            )
          );
        } else {
          console.log(effective !== undefined ? JSON.stringify(effective) : "undefined");
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // config set
  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key, rawValue) => {
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

        storage.setConfig(key, parsed);
        storage.close();
        console.log(`✓ Config '${key}' set to ${JSON.stringify(parsed)}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // config delete
  configCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete a configuration value from local database")
    .action((key) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const projConfig = loadProjectConfig(root);
        const storage = createStorage(projConfig.id, { projectRoot: root });
        const deleted = storage.deleteConfig(key);
        storage.close();
        if (deleted) {
          console.log(`✓ Config '${key}' deleted`);
        } else {
          console.log(`Config '${key}' was not set in database`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
