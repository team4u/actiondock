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
import { ArgumentError, ExecutionError } from "../errors";
import {
  renderConfigEnv,
  renderConfigList,
  renderResult,
  writeStdout,
} from "../renderer";
import type { EnvCheckItem, RuntimeCliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

/**
 * 注册 config 配置管理命令（get、set、list、delete、env）。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerConfigCommands(program: Command, context?: RuntimeCliContext): void {
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
    .action((identifier: string | undefined, rawOptions: any, cmd: any) => {
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

        const globalStorage = createGlobalStorage({ dataDir: options.dataDir || context?.dataDir, customHome: context?.customHome });
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
          renderResult(payload, { json: options.json, envelope: options.envelope, context });
        } else {
          writeStdout(`Configuration Requirements for ${projConfig.id} (${root}):\n`, context);
          if (items.length === 0) {
            writeStdout("  (No configuration dependencies declared for this package)\n", context);
            return;
          }

          writeStdout(
            `  ${"KEY".padEnd(24)} ${"STATUS".padEnd(12)} ${"SOURCE".padEnd(10)} ${"SECRET".padEnd(8)} DESCRIPTION\n`,
            context
          );
          writeStdout("  " + "-".repeat(85) + "\n", context);

          for (const item of items) {
            const statusLabel = item.status === "SET" ? "[SET]" : item.status === "DEFAULT" ? "[DEFAULT]" : "[MISSING]";
            const secretLabel = item.secret ? "yes" : "no";
            writeStdout(
              `  ${item.key.padEnd(24)} ${statusLabel.padEnd(12)} ${item.source.padEnd(10)} ${secretLabel.padEnd(8)} ${item.description}\n`,
              context
            );
          }

          if (missingRequired.length > 0) {
            writeStdout(`\n[WARNING] ${missingRequired.length} required config(s) not set:\n`, context);
            for (const m of missingRequired) {
              writeStdout(`  - ${m.key}: Run 'ad config set ${m.key} <value>' to configure.\n`, context);
            }
          } else {
            writeStdout("\n[OK] All configuration dependencies are satisfied.\n", context);
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
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;
      const reveal = Boolean(options.reveal || options.showSecrets);

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: options.dataDir || context.dataDir });
        const stored = storage.listConfig();
        storage.close();

        const declared = sa.configDefs || {};
        const allKeys = new Set([...Object.keys(declared), ...Object.keys(stored)]);

        const rawList = Array.from(allKeys).map((k) => {
          let rawValue: unknown;
          let source = "default";
          const envResolved = resolveEnvValue(k, declared[k], sa.packageId);
          if (stored[k] !== undefined) {
            rawValue = stored[k];
            source = "project";
          } else if (envResolved !== undefined) {
            rawValue = envResolved.value;
            source = "env";
          } else {
            rawValue = declared[k]?.default;
            source = "default";
          }

          const isSecret = isSecretConfigKey(k, declared[k]);
          const displayValue = !reveal && isSecret && rawValue !== undefined ? maskSecretValue(rawValue) : rawValue;

          return {
            key: k,
            value: displayValue,
            source,
            secret: isSecret,
            description: declared[k]?.description || "",
          };
        });

        const filterRes = filterWithFallbackInfo(
          rawList,
          effectiveIntent,
          [(c) => c.key, (c) => c.value, (c) => c.description, (c) => c.source],
          shouldFallback
        );

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderConfigList(
              filterRes.items,
              `${sa.packageId} (Standalone)`,
              filterRes.isFallback,
              effectiveIntent,
              reveal
            ),
          context,
        });
        return;
      }

      // 2. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        const res = await fetchRemoteConfig(target.serverUrl!, target.token, options.package);
        const entries = Object.entries(res.values || {}).map(([k, v]) => ({
          key: k,
          value: v,
          source: "remote",
          secret: isSecretConfigKey(k, res.declared?.[k]),
          description: res.declared?.[k]?.description || "",
        }));

        renderResult(entries, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderConfigList(
              entries,
              `Remote Server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}`,
              false,
              effectiveIntent,
              reveal
            ),
          context,
        });
        return;
      }

      // 3. 本地与全局配置存储
      if (options.package && !options.global) {
        const directRoot = resolvePackageRoot(options.package);
        if (!directRoot) {
          throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
        }
      }

      const globalStorage = createGlobalStorage({ dataDir: options.dataDir || context?.dataDir, customHome: context?.customHome });
      const globalConfig = globalStorage.listConfig();
      globalStorage.close();

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
            dataDir: options.dataDir || context?.dataDir,
          });
          projectStored = projectStorage.listConfig();
          declaredDefaults = projConfig.config || {};
          projectStorage.close();
        } catch {
          // 忽略工程加载失败
        }
      }

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

      const scopeLabel = projectRoot ? `${packageId} (${projectRoot})` : "Global Scope";

      renderResult(filterRes.items, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () =>
          renderConfigList(filterRes.items, scopeLabel, filterRes.isFallback, effectiveIntent, reveal),
        context,
      });
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
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key required for get");
      }

      const reveal = Boolean(options.reveal || options.showSecrets);

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: options.dataDir || context.dataDir });
        const val = storage.getConfig(key);
        storage.close();

        const declared = sa.configDefs?.[key];
        const isSecret = isSecretConfigKey(key, declared);
        const envResolved = resolveEnvValue(key, declared, sa.packageId);
        const effectiveRaw = val !== undefined ? val : (envResolved !== undefined ? envResolved.value : declared?.default);
        const displayVal = !reveal && isSecret && effectiveRaw !== undefined ? maskSecretValue(effectiveRaw) : effectiveRaw;

        const payload = {
          key,
          value: displayVal,
          source: val !== undefined ? "project" : (envResolved !== undefined ? "env" : "default"),
          secret: isSecret,
        };

        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            displayVal !== undefined
              ? typeof displayVal === "string" && isSecret && !reveal
                ? displayVal
                : JSON.stringify(displayVal)
              : "undefined",
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
        const res = await fetchRemoteConfig(target.serverUrl!, target.token, options.package);
        const val = res.values?.[key];
        const payload = { key, value: val };

        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => (val !== undefined ? JSON.stringify(val) : "undefined"),
          context,
        });
        return;
      }

      // 3. 本地与全局查询
      if (options.package && !options.global) {
        const directRoot = resolvePackageRoot(options.package);
        if (!directRoot) {
          throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
        }
      }

      const globalStorage = createGlobalStorage({ dataDir: options.dataDir || context?.dataDir, customHome: context?.customHome });
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
            dataDir: options.dataDir || context?.dataDir,
          });
          projVal = projectStorage.getConfig(key);
          fallbackVal = projConfig.config?.[key]?.default;
          projectStorage.close();
        } catch {
          // 忽略
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

      const payload = {
        key,
        value: effective,
        source,
        secret: isSecret,
      };

      renderResult(payload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () =>
          effective !== undefined
            ? typeof effective === "string" && isSecret && !reveal
              ? effective
              : JSON.stringify(effective)
            : "undefined",
        context,
      });
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
    .action(async (key: string, rawValue: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key || rawValue === undefined) {
        throw new ArgumentError("Both key and value are required for config set");
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
        const storage = createStorage(sa.packageId, { dataDir: options.dataDir || context.dataDir });
        storage.setConfig(key, parsed);
        storage.close();

        const isSecret = isSecretConfigKey(key, sa.configDefs?.[key]);
        const displayVal = isSecret ? maskSecretValue(parsed) : JSON.stringify(parsed);
        writeStdout(`[OK] Config '${key}' set to ${displayVal} in ${sa.packageId}`, context);
        return;
      }

      // 2. 远端服务模式
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        await setRemoteConfig(target.serverUrl!, key, parsed, target.token, options.package);
        writeStdout(`[OK] Remote config '${key}' updated on ${target.serverUrl}`, context);
        return;
      }

      // 3. 本地存储模式
      if (options.package && !options.global) {
        const directRoot = resolvePackageRoot(options.package);
        if (!directRoot) {
          throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
        }
      }

      const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
      let declaredItem: ConfigItemDefinition | undefined;
      let projConfig: any;
      if (projectRoot) {
        try {
          projConfig = loadProjectConfig(projectRoot);
          declaredItem = projConfig.config?.[key];
        } catch {
          // 忽略工程加载失败
        }
      }
      const isSecret = isSecretConfigKey(key, declaredItem);
      const displayVal = isSecret ? maskSecretValue(parsed) : JSON.stringify(parsed);

      if (options.global || !projectRoot) {
        const globalStorage = createGlobalStorage({ dataDir: options.dataDir || context?.dataDir, customHome: context?.customHome });
        globalStorage.setConfig(key, parsed);
        globalStorage.close();
        writeStdout(`[OK] Global config '${key}' set to ${displayVal}`, context);
      } else {
        const storage = createStorage(projConfig.id, {
          projectRoot,
          dataDir: options.dataDir || context?.dataDir,
        });
        storage.setConfig(key, parsed);
        storage.close();
        writeStdout(`[OK] Config '${key}' set to ${displayVal} in ${projConfig.id}`, context);
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
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key required for delete");
      }

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: options.dataDir || context.dataDir });
        const deleted = storage.deleteConfig(key);
        storage.close();

        if (deleted) {
          writeStdout(`[OK] Config '${key}' deleted from ${sa.packageId}`, context);
        } else {
          writeStdout(`Config '${key}' was not found in ${sa.packageId}`, context);
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
        const res = await deleteRemoteConfig(target.serverUrl!, key, target.token, options.package);
        if (res.deleted) {
          writeStdout(`[OK] Remote config '${key}' deleted from ${target.serverUrl}`, context);
        } else {
          writeStdout(`Remote config '${key}' not found on ${target.serverUrl}`, context);
        }
        return;
      }

      // 3. 本地存储模式
      if (options.package && !options.global) {
        const directRoot = resolvePackageRoot(options.package);
        if (!directRoot) {
          throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
        }
      }

      const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;

      if (options.global || !projectRoot) {
        const globalStorage = createGlobalStorage({ dataDir: options.dataDir || context?.dataDir, customHome: context?.customHome });
        const deleted = globalStorage.deleteConfig(key);
        globalStorage.close();
        if (deleted) {
          writeStdout(`[OK] Global config '${key}' deleted`, context);
        } else {
          writeStdout(`Global config '${key}' was not found`, context);
        }
      } else {
        const projConfig = loadProjectConfig(projectRoot);
        const storage = createStorage(projConfig.id, {
          projectRoot,
          dataDir: options.dataDir || context?.dataDir,
        });
        const deleted = storage.deleteConfig(key);
        storage.close();
        if (deleted) {
          writeStdout(`[OK] Config '${key}' deleted from ${projConfig.id}`, context);
        } else {
          writeStdout(`Config '${key}' was not set in database for ${projConfig.id}`, context);
        }
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
      const options = getEffectiveOptions(rawOptions, cmd);
      // 1. 独立模式
      if (context?.standalone) {
        const sa = context.standalone;
        const declared = sa.configDefs || {};
        const envChecks: EnvCheckItem[] = [];

        for (const [k, def] of Object.entries(declared)) {
          const envResolved = resolveEnvValue(k, def, sa.packageId);
          envChecks.push({
            key: k,
            required: def.default === undefined,
            satisfied: Boolean(envResolved !== undefined || def.default !== undefined),
            matchedEnv: envResolved?.envKey || null,
            hasDefault: def.default !== undefined,
            secret: isSecretConfigKey(k, def),
          });
        }

        const payload = { ok: true, packageId: sa.packageId, envChecks };
        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderConfigEnv(envChecks, sa.packageId),
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
        const res = await fetchRemoteConfigEnv(target.serverUrl!, target.token, options.package);
        renderResult(res, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderConfigEnv(res.envChecks || [], res.packageId),
          context,
        });
        return;
      }

      // 3. 本地工程模式
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
          secret: isSecretConfigKey(k, def),
        });
      }

      const payload = { ok: true, packageId: cfg.id, envChecks };
      renderResult(payload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderConfigEnv(envChecks, cfg.id),
        context,
      });
    });
}
