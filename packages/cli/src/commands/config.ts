import {
  createGlobalStorage,
  createStorage,
  filterWithFallbackInfo,
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage runtime configuration store (Global & Project-level)");

  // config list
  configCmd
    .command("list [patterns...]")
    .description("List configuration entries (Global & Project)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Show only global configurations")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action((patterns, options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;

        const globalStorage = createGlobalStorage();
        const globalConfig = globalStorage.listConfig();

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
        let projectStored: Record<string, unknown> = {};
        let declaredDefaults: Record<string, { description?: string; default?: unknown }> = {};
        let packageId = "global";

        if (projectRoot) {
          try {
            const projConfig = loadProjectConfig(projectRoot);
            packageId = projConfig.id;
            const projectStorage = createStorage(projConfig.id, { projectRoot });
            projectStored = projectStorage.listConfig();
            declaredDefaults = projConfig.config || {};
            projectStorage.close();
          } catch {
            // Ignore project load error
          }
        }

        globalStorage.close();

        const allKeys = new Set([
          ...Object.keys(declaredDefaults),
          ...Object.keys(globalConfig),
          ...Object.keys(projectStored),
        ]);

        const rawList = Array.from(allKeys).map((k) => {
          let value: unknown;
          let source: "project" | "global" | "default" = "default";

          if (projectStored[k] !== undefined) {
            value = projectStored[k];
            source = "project";
          } else if (globalConfig[k] !== undefined) {
            value = globalConfig[k];
            source = "global";
          } else {
            value = declaredDefaults[k]?.default;
            source = "default";
          }

          return {
            key: k,
            value,
            source,
            description: declaredDefaults[k]?.description || "",
          };
        });

        const filterRes = filterWithFallbackInfo(
          rawList,
          effectiveIntent,
          [(c) => c.key, (c) => c.value, (c) => c.description, (c) => c.source],
          shouldFallback
        );

        if (options.json) {
          console.log(JSON.stringify(filterRes.items, null, 2));
        } else {
          const scopeLabel = projectRoot ? `${packageId} (${projectRoot})` : "Global Scope";
          console.log(`Configurations [${scopeLabel}]:\n`);
          if (filterRes.isFallback && effectiveIntent) {
            console.log(`(No config entries matched intent '${effectiveIntent}', showing all entries)\n`);
          }
          if (filterRes.items.length === 0) {
            console.log("  (No configuration entries found)");
          }
          for (const item of filterRes.items) {
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
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Get from global configuration only")
    .option("--json", "Output as JSON")
    .action((key, options) => {
      try {
        const globalStorage = createGlobalStorage();
        const globalVal = globalStorage.getConfig(key);
        globalStorage.close();

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
        let projVal: unknown = undefined;
        let fallbackVal: unknown = undefined;

        if (projectRoot) {
          try {
            const projConfig = loadProjectConfig(projectRoot);
            const projectStorage = createStorage(projConfig.id, { projectRoot });
            projVal = projectStorage.getConfig(key);
            fallbackVal = projConfig.config?.[key]?.default;
            projectStorage.close();
          } catch {
            // Ignore
          }
        }

        let effective = projVal !== undefined ? projVal : globalVal !== undefined ? globalVal : fallbackVal;
        let source: string =
          projVal !== undefined ? "project" : globalVal !== undefined ? "global" : fallbackVal !== undefined ? "default" : "undefined";

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                key,
                value: effective,
                source,
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
    .description("Set a configuration value (Global by default outside project, or use -g for global)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Set globally across all packages")
    .action((key, rawValue, options) => {
      try {
        let parsed: unknown = rawValue;
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          parsed = rawValue;
        }

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;

        if (options.global || !projectRoot) {
          // Set in Global storage (~/.actiondock/global.db)
          const globalStorage = createGlobalStorage();
          globalStorage.setConfig(key, parsed);
          globalStorage.close();
          console.log(`[OK] Global config '${key}' set to ${JSON.stringify(parsed)}`);
        } else {
          // Set in Project storage
          const projConfig = loadProjectConfig(projectRoot);
          const storage = createStorage(projConfig.id, { projectRoot });
          storage.setConfig(key, parsed);
          storage.close();
          console.log(`[OK] Config '${key}' set to ${JSON.stringify(parsed)} in ${projConfig.id}`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // config delete
  configCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete a configuration value")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Delete from global configuration")
    .action((key, options) => {
      try {
        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;

        if (options.global || !projectRoot) {
          const globalStorage = createGlobalStorage();
          const deleted = globalStorage.deleteConfig(key);
          globalStorage.close();
          if (deleted) {
            console.log(`[OK] Global config '${key}' deleted`);
          } else {
            console.log(`Global config '${key}' was not found`);
          }
        } else {
          const projConfig = loadProjectConfig(projectRoot);
          const storage = createStorage(projConfig.id, { projectRoot });
          const deleted = storage.deleteConfig(key);
          storage.close();
          if (deleted) {
            console.log(`[OK] Config '${key}' deleted from ${projConfig.id}`);
          } else {
            console.log(`Config '${key}' was not set in database for ${projConfig.id}`);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
