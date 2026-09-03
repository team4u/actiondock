import {
  createGlobalStorage,
  createStorage,
  filterWithFallbackInfo,
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolvePackageRoot,
  type ConfigItemDefinition,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage runtime configuration store (Global & Project-level)");

  // config schema / check
  configCmd
    .command("schema [identifier]")
    .alias("check")
    .description("Inspect declared configuration requirements and check resolution status")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--json", "Output as JSON")
    .action((identifier, options) => {
      try {
        const root = resolvePackageRoot(identifier || options.package);
        if (!root) {
          console.error(
            "Error: Not in an ActionDock project.\nUsage: ad config schema [package-id] or cd into a project directory."
          );
          process.exit(1);
        }

        const projConfig = loadProjectConfig(root);
        const declared = projConfig.config || {};
        const declaredKeys = Object.keys(declared);

        const globalStorage = createGlobalStorage();
        const globalConfig = globalStorage.listConfig();
        globalStorage.close();

        const projectStorage = createStorage(projConfig.id, { projectRoot: root });
        const projectConfig = projectStorage.listConfig();
        projectStorage.close();

        const items = declaredKeys.map((key) => {
          const itemDef = declared[key];
          const isSecret = isSecretConfigKey(key, itemDef);

          let resolvedValue: unknown;
          let source: "project" | "global" | "env" | "default" | "missing" = "missing";
          let status: "SET" | "DEFAULT" | "MISSING" = "MISSING";

          if (projectConfig[key] !== undefined) {
            resolvedValue = projectConfig[key];
            source = "project";
            status = "SET";
          } else if (globalConfig[key] !== undefined) {
            resolvedValue = globalConfig[key];
            source = "global";
            status = "SET";
          } else if (typeof process !== "undefined" && process.env && process.env[key] !== undefined) {
            resolvedValue = process.env[key];
            source = "env";
            status = "SET";
          } else if (itemDef.default !== undefined) {
            resolvedValue = itemDef.default;
            source = "default";
            status = "DEFAULT";
          } else {
            status = "MISSING";
          }

          return {
            key,
            description: itemDef.description || "",
            secret: isSecret,
            default: itemDef.default,
            status,
            source,
            value: isSecret && resolvedValue !== undefined ? maskSecretValue(resolvedValue) : resolvedValue,
            required: itemDef.default === undefined,
          };
        });

        const missingRequired = items.filter((i) => i.status === "MISSING");

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                packageId: projConfig.id,
                projectRoot: root,
                allReady: missingRequired.length === 0,
                configs: items,
              },
              null,
              2
            )
          );
        } else {
          console.log(`Configuration Requirements for ${projConfig.id} (${root}):\n`);
          if (items.length === 0) {
            console.log("  (No configuration dependencies declared for this package)");
            return;
          }

          console.log(
            `  ${"KEY".padEnd(24)} ${"STATUS".padEnd(12)} ${"SOURCE".padEnd(10)} ${"SECRET".padEnd(8)} DESCRIPTION`
          );
          console.log("  " + "-".repeat(85));

          for (const item of items) {
            const statusLabel = item.status === "SET" ? "[SET]" : item.status === "DEFAULT" ? "[DEFAULT]" : "[MISSING]";
            const secretLabel = item.secret ? "yes" : "no";
            console.log(
              `  ${item.key.padEnd(24)} ${statusLabel.padEnd(12)} ${item.source.padEnd(10)} ${secretLabel.padEnd(8)} ${item.description}`
            );
          }

          if (missingRequired.length > 0) {
            console.log(`\n[WARNING] ${missingRequired.length} required config(s) not set:`);
            for (const m of missingRequired) {
              console.log(`  - ${m.key}: Run 'ad config set ${m.key} <value>' to configure.`);
            }
          } else {
            console.log("\n[OK] All configuration dependencies are satisfied.");
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // config list
  configCmd
    .command("list [patterns...]")
    .description("List configuration entries (Global & Project)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Show only global configurations")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--reveal, --show-secrets", "Reveal plain text values for secrets")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action((patterns, options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;
        const reveal = options.reveal || options.showSecrets;

        const globalStorage = createGlobalStorage();
        const globalConfig = globalStorage.listConfig();

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
        let projectStored: Record<string, unknown> = {};
        let declaredDefaults: Record<string, ConfigItemDefinition> = {};
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
          let rawValue: unknown;
          let source: "project" | "global" | "env" | "default" = "default";

          if (projectStored[k] !== undefined) {
            rawValue = projectStored[k];
            source = "project";
          } else if (globalConfig[k] !== undefined) {
            rawValue = globalConfig[k];
            source = "global";
          } else if (typeof process !== "undefined" && process.env && process.env[k] !== undefined) {
            rawValue = process.env[k];
            source = "env";
          } else {
            rawValue = declaredDefaults[k]?.default;
            source = "default";
          }

          const isSecret = isSecretConfigKey(k, declaredDefaults[k]);
          const displayValue = !reveal && isSecret && rawValue !== undefined ? maskSecretValue(rawValue) : rawValue;

          return {
            key: k,
            value: displayValue,
            source,
            secret: isSecret,
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
            const valStr = typeof item.value === "string" && item.secret && !reveal ? item.value : JSON.stringify(item.value);
            const secretBadge = item.secret ? ", secret" : "";
            console.log(`  ${item.key.padEnd(24)} = ${valStr} (${item.source}${secretBadge})`);
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
    .option("--reveal, --show-secrets", "Reveal plain text value for secret")
    .option("--json", "Output as JSON")
    .action((key, options) => {
      try {
        const reveal = options.reveal || options.showSecrets;
        const globalStorage = createGlobalStorage();
        const globalVal = globalStorage.getConfig(key);
        globalStorage.close();

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
        let projVal: unknown = undefined;
        let fallbackVal: unknown = undefined;
        let declaredItem: ConfigItemDefinition | undefined;

        if (projectRoot) {
          try {
            const projConfig = loadProjectConfig(projectRoot);
            declaredItem = projConfig.config?.[key];
            const projectStorage = createStorage(projConfig.id, { projectRoot });
            projVal = projectStorage.getConfig(key);
            fallbackVal = projConfig.config?.[key]?.default;
            projectStorage.close();
          } catch {
            // Ignore
          }
        }

        const envVal = typeof process !== "undefined" && process.env ? process.env[key] : undefined;

        const rawEffective =
          projVal !== undefined
            ? projVal
            : globalVal !== undefined
            ? globalVal
            : envVal !== undefined
            ? envVal
            : fallbackVal;

        const source: string =
          projVal !== undefined
            ? "project"
            : globalVal !== undefined
            ? "global"
            : envVal !== undefined
            ? "env"
            : fallbackVal !== undefined
            ? "default"
            : "undefined";

        const isSecret = isSecretConfigKey(key, declaredItem);
        const effective = !reveal && isSecret && rawEffective !== undefined ? maskSecretValue(rawEffective) : rawEffective;

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                key,
                value: effective,
                source,
                secret: isSecret,
              },
              null,
              2
            )
          );
        } else {
          console.log(effective !== undefined ? (typeof effective === "string" && isSecret && !reveal ? effective : JSON.stringify(effective)) : "undefined");
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
        const isSecret = isSecretConfigKey(key);
        const displayVal = isSecret ? maskSecretValue(parsed) : JSON.stringify(parsed);

        if (options.global || !projectRoot) {
          // Set in Global storage (~/.actiondock/global.db)
          const globalStorage = createGlobalStorage();
          globalStorage.setConfig(key, parsed);
          globalStorage.close();
          console.log(`[OK] Global config '${key}' set to ${displayVal}`);
        } else {
          // Set in Project storage
          const projConfig = loadProjectConfig(projectRoot);
          const storage = createStorage(projConfig.id, { projectRoot });
          storage.setConfig(key, parsed);
          storage.close();
          console.log(`[OK] Config '${key}' set to ${displayVal} in ${projConfig.id}`);
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
