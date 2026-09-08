import {
  createGlobalStorage,
  createStorage,
  deleteRemoteConfig,
  fetchRemoteConfig,
  fetchRemoteConfigEnv,
  filterWithFallbackInfo,
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolvePackageRoot,
  resolveTarget,
  setRemoteConfig,
  resolveEnvValue,
  type ConfigItemDefinition,
} from "@actiondock/core";
import { Command } from "commander";
import {
  ArgumentError,
  ExecutionError,
  getEffectiveOptions,
  renderResult,
  renderConfigEnv,
  type EnvCheckItem,
} from "@actiondock/runtime-cli";
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
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action((identifier, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const targetPkg = identifier || options.package;
        const root = resolvePackageRoot(targetPkg);
        if (!root) {
          if (targetPkg) {
            throw new ArgumentError(
              `Package '${targetPkg}' not found in linked packages or path`
            );
          }
          throw new ArgumentError(
            "Not in an ActionDock project.\nUsage: ad config schema [package-id] or cd into a project directory."
          );
        }

        const projConfig = loadProjectConfig(root);
        const declared = projConfig.config || {};
        const declaredKeys = Object.keys(declared);

        const globalStorage = createGlobalStorage(options.dataDir);
        const globalConfig = globalStorage.listConfig();
        globalStorage.close();

        const projectStorage = createStorage(projConfig.id, {
          projectRoot: root,
          dataDir: options.dataDir,
        });
        const projectConfig = projectStorage.listConfig();
        projectStorage.close();

        const items = declaredKeys.map((key) => {
          const itemDef = declared[key];
          const isSecret = isSecretConfigKey(key, itemDef);

          let resolvedValue: unknown;
          let source: "project" | "global" | "env" | "default" | "missing" = "missing";
          let status: "SET" | "DEFAULT" | "MISSING" = "MISSING";
          const envResolved = resolveEnvValue(key, itemDef, projConfig.id);

          if (projectConfig[key] !== undefined) {
            resolvedValue = projectConfig[key];
            source = "project";
            status = "SET";
          } else if (globalConfig[key] !== undefined) {
            resolvedValue = globalConfig[key];
            source = "global";
            status = "SET";
          } else if (envResolved !== undefined) {
            resolvedValue = envResolved.value;
            source = "env";
            status = "SET";
          } else if (itemDef.default !== undefined) {
            resolvedValue = itemDef.default;
            source = "default";
            status = "DEFAULT";
          }

          const displayValue = isSecret && resolvedValue !== undefined ? maskSecretValue(resolvedValue) : resolvedValue;

          return {
            key,
            value: displayValue,
            status,
            source,
            secret: isSecret,
            description: itemDef.description || "",
            required: itemDef.default === undefined,
          };
        });

        const missingRequired = items.filter((i) => i.status === "MISSING");
        const payload = {
          packageId: projConfig.id,
          projectRoot: root,
          allReady: missingRequired.length === 0,
          configs: items,
        };

        if (options.json || options.envelope) {
          renderResult(payload, { json: options.json, envelope: options.envelope });
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
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });

  // config list
  configCmd
    .command("list [patterns...]")
    .description("List configuration entries (Global & Project)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Show only global configurations")
    .option("-p, --profile <name>", "Query config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--reveal, --show-secrets", "Reveal plain text values for secrets")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const isMachine = Boolean(options.json || options.envelope);
        const fallbackExplicit = options.fallback === true || (Array.isArray(process.argv) && process.argv.includes("--fallback"));
        const shouldFallback = isMachine ? fallbackExplicit : options.fallback !== false;
        const reveal = options.reveal || options.showSecrets;

        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const res = await fetchRemoteConfig(target.serverUrl!, target.token, options.package);
          if (isMachine) {
            renderResult(res, { json: options.json, envelope: options.envelope });
            return;
          }
          console.log(
            `Config on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}:\n`
          );
          const entries = Object.entries(res.values || {});
          if (entries.length === 0) {
            console.log("  (No config entries stored)");
          } else {
            for (const [k, v] of entries) {
              console.log(`  ${k.padEnd(24)} = ${JSON.stringify(v)}`);
            }
          }
          return;
        }

        if (options.package && !options.global) {
          const directRoot = resolvePackageRoot(options.package);
          if (!directRoot) {
            throw new ArgumentError(
              `Package '${options.package}' not found in linked packages or path`
            );
          }
        }

        const globalStorage = createGlobalStorage(options.dataDir);
        const globalConfig = globalStorage.listConfig();

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
        let projectStored: Record<string, unknown> = {};
        let declaredDefaults: Record<string, ConfigItemDefinition> = {};
        let packageId = "global";

        if (projectRoot) {
          try {
            const projConfig = loadProjectConfig(projectRoot);
            packageId = projConfig.id;
            const projectStorage = createStorage(projConfig.id, {
              projectRoot,
              dataDir: options.dataDir,
            });
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
          const envResolved = resolveEnvValue(k, declaredDefaults[k], projectRoot ? packageId : undefined);

          if (projectStored[k] !== undefined) {
            rawValue = projectStored[k];
            source = "project";
          } else if (globalConfig[k] !== undefined) {
            rawValue = globalConfig[k];
            source = "global";
          } else if (envResolved !== undefined) {
            rawValue = envResolved.value;
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

        if (isMachine) {
          renderResult(filterRes.items, { json: options.json, envelope: options.envelope });
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
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });

  // config get
  configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Get from global configuration only")
    .option("-p, --profile <name>", "Query config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--reveal, --show-secrets", "Reveal plain text value for secret")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (key, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const isMachine = Boolean(options.json || options.envelope);
        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const res = await fetchRemoteConfig(target.serverUrl!, target.token, options.package);
          const val = res.values?.[key];
          if (isMachine) {
            renderResult({ key, value: val }, { json: options.json, envelope: options.envelope });
          } else {
            console.log(val !== undefined ? JSON.stringify(val) : "undefined");
          }
          return;
        }

        if (options.package && !options.global) {
          const directRoot = resolvePackageRoot(options.package);
          if (!directRoot) {
            throw new ArgumentError(
              `Package '${options.package}' not found in linked packages or path`
            );
          }
        }

        const reveal = options.reveal || options.showSecrets;
        const globalStorage = createGlobalStorage(options.dataDir);
        const globalVal = globalStorage.getConfig(key);
        globalStorage.close();

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
        let projVal: unknown = undefined;
        let fallbackVal: unknown = undefined;
        let declaredItem: ConfigItemDefinition | undefined;
        let packageId: string | undefined;

        if (projectRoot) {
          try {
            const projConfig = loadProjectConfig(projectRoot);
            packageId = projConfig.id;
            declaredItem = projConfig.config?.[key];
            const projectStorage = createStorage(projConfig.id, {
              projectRoot,
              dataDir: options.dataDir,
            });
            projVal = projectStorage.getConfig(key);
            fallbackVal = projConfig.config?.[key]?.default;
            projectStorage.close();
          } catch {
            // Ignore
          }
        }

        const envResolved = resolveEnvValue(key, declaredItem, packageId);
        const envVal = envResolved !== undefined ? envResolved.value : undefined;

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

        if (isMachine) {
          renderResult(
            {
              key,
              value: effective,
              source,
              secret: isSecret,
            },
            { json: options.json, envelope: options.envelope }
          );
        } else {
          console.log(effective !== undefined ? (typeof effective === "string" && isSecret && !reveal ? effective : JSON.stringify(effective)) : "undefined");
        }
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });

  // config set
  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value (Global by default outside project, or use -g for global)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Set globally across all packages")
    .option("-p, --profile <name>", "Set config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (key, rawValue, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const isMachine = Boolean(options.json || options.envelope);
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
          await setRemoteConfig(target.serverUrl!, key, parsed, target.token, options.package);
          if (isMachine) {
            renderResult({ ok: true, key, value: parsed }, { json: options.json, envelope: options.envelope });
          } else {
            console.log(`[OK] Remote config '${key}' updated on ${target.serverUrl}`);
          }
          return;
        }

        if (options.package && !options.global) {
          const directRoot = resolvePackageRoot(options.package);
          if (!directRoot) {
            throw new ArgumentError(
              `Package '${options.package}' not found in linked packages or path`
            );
          }
        }

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
        const isSecret = isSecretConfigKey(key);
        const displayVal = isSecret ? maskSecretValue(parsed) : JSON.stringify(parsed);

        if (options.global || !projectRoot) {
          // Set in Global storage
          const globalStorage = createGlobalStorage(options.dataDir);
          globalStorage.setConfig(key, parsed);
          globalStorage.close();
          if (isMachine) {
            renderResult({ ok: true, key, value: parsed, scope: "global" }, { json: options.json, envelope: options.envelope });
          } else {
            console.log(`[OK] Global config '${key}' set to ${displayVal}`);
          }
        } else {
          // Set in Project storage
          const projConfig = loadProjectConfig(projectRoot);
          const storage = createStorage(projConfig.id, {
            projectRoot,
            dataDir: options.dataDir,
          });
          storage.setConfig(key, parsed);
          storage.close();
          if (isMachine) {
            renderResult({ ok: true, key, value: parsed, packageId: projConfig.id }, { json: options.json, envelope: options.envelope });
          } else {
            console.log(`[OK] Config '${key}' set to ${displayVal} in ${projConfig.id}`);
          }
        }
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });

  // config delete
  configCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete a configuration value")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Delete from global configuration")
    .option("-p, --profile <name>", "Delete config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (key, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const isMachine = Boolean(options.json || options.envelope);
        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const res = await deleteRemoteConfig(target.serverUrl!, key, target.token, options.package);
          if (isMachine) {
            renderResult(res, { json: options.json, envelope: options.envelope });
          } else if (res.deleted) {
            console.log(`[OK] Remote config '${key}' deleted from ${target.serverUrl}`);
          } else {
            console.log(`Remote config '${key}' not found on ${target.serverUrl}`);
          }
          return;
        }

        if (options.package && !options.global) {
          const directRoot = resolvePackageRoot(options.package);
          if (!directRoot) {
            throw new ArgumentError(
              `Package '${options.package}' not found in linked packages or path`
            );
          }
        }

        const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;

        if (options.global || !projectRoot) {
          const globalStorage = createGlobalStorage(options.dataDir);
          const deleted = globalStorage.deleteConfig(key);
          globalStorage.close();
          if (isMachine) {
            renderResult({ ok: true, key, deleted, scope: "global" }, { json: options.json, envelope: options.envelope });
          } else if (deleted) {
            console.log(`[OK] Global config '${key}' deleted`);
          } else {
            console.log(`Global config '${key}' was not found`);
          }
        } else {
          const projConfig = loadProjectConfig(projectRoot);
          const storage = createStorage(projConfig.id, {
            projectRoot,
            dataDir: options.dataDir,
          });
          const deleted = storage.deleteConfig(key);
          storage.close();
          if (isMachine) {
            renderResult({ ok: true, key, deleted, packageId: projConfig.id }, { json: options.json, envelope: options.envelope });
          } else if (deleted) {
            console.log(`[OK] Config '${key}' deleted from ${projConfig.id}`);
          } else {
            console.log(`Config '${key}' was not set in database for ${projConfig.id}`);
          }
        }
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });

  // config env: 检查环境变量满足率
  configCmd
    .command("env")
    .description("Check environment variable satisfaction for declared configuration")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawOptions: any, cmd: any) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        // 1. 远端服务模式
        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const res = await fetchRemoteConfigEnv(target.serverUrl!, target.token, options.package);
          renderResult(res, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => renderConfigEnv(res.envChecks || [], res.packageId),
          });
          return;
        }

        // 2. 本地工程模式
        const root = resolvePackageRoot(options.package);
        if (!root) {
          if (options.package) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          throw new ArgumentError(
            "Not in an ActionDock project. Usage: ad config env -P <package-id> or cd into a project directory."
          );
        }

        const cfg = loadProjectConfig(root);
        const declared = cfg.config || {};
        const envChecks: EnvCheckItem[] = [];

        for (const [k, def] of Object.entries(declared)) {
          const envResolved = resolveEnvValue(k, def, cfg.id);
          envChecks.push({
            key: k,
            required: def.default === undefined,
            satisfied: Boolean(envResolved !== undefined || def.default !== undefined),
            matchedEnv: envResolved?.envKey || null,
            hasDefault: def.default !== undefined,
            secret: Boolean(def.secret),
          });
        }

        const payload = { ok: true, packageId: cfg.id, envChecks };
        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderConfigEnv(envChecks, cfg.id),
        });
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });
}
