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
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        const stored = storage.listConfig();
        storage.close();

        const declared = sa.configDefs || {};
        const allKeys = new Set([...Object.keys(declared), ...Object.keys(stored)]);

        const rawList = Array.from(allKeys).map((k) => {
          let rawValue: unknown;
          let source = "default";
          if (stored[k] !== undefined) {
            rawValue = stored[k];
            source = "project";
          } else if (typeof process !== "undefined" && process.env && process.env[k] !== undefined) {
            rawValue = process.env[k];
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
          secret: isSecretConfigKey(k),
          description: "",
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
      const globalStorage = createGlobalStorage();
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
          const projectStorage = createStorage(projConfig.id, { projectRoot });
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
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
        const val = storage.getConfig(key);
        storage.close();

        const declared = sa.configDefs?.[key];
        const isSecret = isSecretConfigKey(key, declared);
        const effectiveRaw = val !== undefined ? val : (process.env[key] !== undefined ? process.env[key] : declared?.default);
        const displayVal = !reveal && isSecret && effectiveRaw !== undefined ? maskSecretValue(effectiveRaw) : effectiveRaw;

        const payload = {
          key,
          value: displayVal,
          source: val !== undefined ? "project" : (process.env[key] !== undefined ? "env" : "default"),
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
          // 忽略
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
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
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
      const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;
      const isSecret = isSecretConfigKey(key);
      const displayVal = isSecret ? maskSecretValue(parsed) : JSON.stringify(parsed);

      if (options.global || !projectRoot) {
        const globalStorage = createGlobalStorage();
        globalStorage.setConfig(key, parsed);
        globalStorage.close();
        writeStdout(`[OK] Global config '${key}' set to ${displayVal}`, context);
      } else {
        const projConfig = loadProjectConfig(projectRoot);
        const storage = createStorage(projConfig.id, { projectRoot });
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
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key required for delete");
      }

      // 1. 独立运行模式
      if (context?.standalone) {
        const sa = context.standalone;
        const storage = createStorage(sa.packageId, { dataDir: context.dataDir });
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
      const projectRoot = !options.global ? resolvePackageRoot(options.package) : null;

      if (options.global || !projectRoot) {
        const globalStorage = createGlobalStorage();
        const deleted = globalStorage.deleteConfig(key);
        globalStorage.close();
        if (deleted) {
          writeStdout(`[OK] Global config '${key}' deleted`, context);
        } else {
          writeStdout(`Global config '${key}' was not found`, context);
        }
      } else {
        const projConfig = loadProjectConfig(projectRoot);
        const storage = createStorage(projConfig.id, { projectRoot });
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
          const envKeys = [
            k,
            `ACTIONDOCK_${k}`,
            `${sa.packageId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${k}`,
          ];
          const foundEnv = envKeys.find((ek) => typeof process !== "undefined" && process.env && process.env[ek] !== undefined);
          envChecks.push({
            key: k,
            required: def.default === undefined,
            satisfied: Boolean(foundEnv || def.default !== undefined),
            matchedEnv: foundEnv || null,
            hasDefault: def.default !== undefined,
            secret: Boolean(def.secret),
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
        throw new ArgumentError(
          "Not in an ActionDock project. Usage: ad config env -P <package-id> or cd into a project directory."
        );
      }

      const cfg = loadProjectConfig(root);
      const declared = cfg.config || {};
      const envChecks: EnvCheckItem[] = [];

      for (const [k, def] of Object.entries(declared)) {
        const envKeys = [
          k,
          `ACTIONDOCK_${k}`,
          `${cfg.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${k}`,
        ];
        const foundEnv = envKeys.find((ek) => typeof process !== "undefined" && process.env && process.env[ek] !== undefined);
        envChecks.push({
          key: k,
          required: def.default === undefined,
          satisfied: Boolean(foundEnv || def.default !== undefined),
          matchedEnv: foundEnv || null,
          hasDefault: def.default !== undefined,
          secret: Boolean(def.secret),
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
