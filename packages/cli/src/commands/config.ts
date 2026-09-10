import {
  createActionDockTarget,
  fetchRemoteConfig,
  fetchRemoteConfigEnv,
  filterWithFallbackInfo,
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolvePackageRoot,
  resolveTarget,
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
  writeStderr,
} from "../renderer";
import type { CliContext, EnvCheckItem } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";
import { resolveConfigValueInput } from "../prompt";

/**
 * 注册 config 配置管理命令（get、set、list、delete、env、schema）。
 * 
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerConfigCommands(program: Command, context?: CliContext): void {
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
    .action(async (identifier: string | undefined, rawOptions: any, cmd: any) => {
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

        const target = await createActionDockTarget({
          type: "local",
          projectRoot: root,
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
        });

        let globalConfig: import("@actiondock/core").ConfigValueView[] = [];
        let projectConfig: import("@actiondock/core").ConfigValueView[] = [];
        try {
          globalConfig = await target.listConfig("global");
          projectConfig = await target.listConfig(projConfig.id);
        } finally {
          await target.close();
        }

        const projectConfigMap = new Map(projectConfig.map((c) => [c.key, c]));
        const globalConfigMap = new Map(globalConfig.map((c) => [c.key, c]));

        const items = declaredKeys.map((key) => {
          const itemDef = declared[key];
          const isSecret = isSecretConfigKey(key, itemDef);

          let resolvedValue: unknown;
          let source: "project" | "global" | "env" | "default" | "missing" = "missing";
          let status: "SET" | "DEFAULT" | "MISSING" = "MISSING";
          const envResolved = resolveEnvValue(key, itemDef, projConfig.id);

          const projItem = projectConfigMap.get(key);
          const globItem = globalConfigMap.get(key);

          if (projItem && projItem.configured && projItem.source === "package") {
            resolvedValue = projItem.value;
            source = "project";
            status = "SET";
          } else if (globItem && globItem.configured) {
            resolvedValue = globItem.value;
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

          return {
            key,
            required: Boolean(itemDef.required),
            secret: isSecret,
            status,
            source,
            description: itemDef.description || "",
            defaultValue: itemDef.default,
            hasValue: resolvedValue !== undefined,
          };
        });

        const missingRequired = items.filter((i) => i.required && i.status === "MISSING");
        const ok = missingRequired.length === 0;

        const result = {
          packageId: projConfig.id,
          projectRoot: root,
          ok,
          missingCount: missingRequired.length,
          configs: items,
        };

        if (options.json || options.envelope) {
          renderResult(result, {
            json: options.json,
            envelope: options.envelope,
            context,
          });
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
          writeStdout(`  ${"-".repeat(85)}\n`, context);

          for (const item of items) {
            const statusLabel =
              item.status === "SET"
                ? "[SET]"
                : item.status === "DEFAULT"
                ? "[DEFAULT]"
                : "[MISSING]";
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

      // 1. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

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

      // 2. 本地分支（通过 Target 门面统一访问）
      const root = resolvePackageRoot(options.package);
      const localTarget = await createActionDockTarget({
        type: "local",
        projectRoot: root || undefined,
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
      });

      try {
        if (options.global) {
          const all = await localTarget.listConfig("global");
          const entries = all.map((item) => {
            const isSecret = item.secret || isSecretConfigKey(item.key);
            const displayValue = !reveal && isSecret ? maskSecretValue(item.value) : item.value;
            return {
              key: item.key,
              value: displayValue,
              source: "global",
              secret: isSecret,
            };
          });

          const filterRes = filterWithFallbackInfo(
            entries,
            effectiveIntent,
            [(c) => c.key, (c) => c.value],
            shouldFallback
          );

          renderResult(filterRes.items, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () =>
              renderConfigList(
                filterRes.items,
                "Global Scope",
                filterRes.isFallback,
                effectiveIntent,
                reveal
              ),
            context,
          });
          return;
        }

        if (!root) {
          if (options.package) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }

          const all = await localTarget.listConfig("global");
          const entries = all.map((item) => {
            const isSecret = item.secret || isSecretConfigKey(item.key);
            const displayValue = !reveal && isSecret ? maskSecretValue(item.value) : item.value;
            return {
              key: item.key,
              value: displayValue,
              source: "global",
              secret: isSecret,
            };
          });

          const filterRes = filterWithFallbackInfo(
            entries,
            effectiveIntent,
            [(c) => c.key, (c) => c.value],
            shouldFallback
          );

          renderResult(filterRes.items, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () =>
              renderConfigList(
                filterRes.items,
                "Global Scope (No project found)",
                filterRes.isFallback,
                effectiveIntent,
                reveal
              ),
            context,
          });
          return;
        }

        const projConfig = loadProjectConfig(root);
        const declared = projConfig.config || {};

        const globalConfigList = await localTarget.listConfig("global");
        const projectConfigList = await localTarget.listConfig(projConfig.id);

        const projectConfigMap = new Map(projectConfigList.map((c) => [c.key, c]));
        const globalConfigMap = new Map(globalConfigList.map((c) => [c.key, c]));

        const allKeys = new Set([
          ...Object.keys(declared),
          ...projectConfigList.map((c) => c.key),
          ...globalConfigList.map((c) => c.key),
        ]);

      const merged = Array.from(allKeys).map((k) => {
        let rawValue: unknown;
        let source = "default";
        const envResolved = resolveEnvValue(k, declared[k], projConfig.id);
        const projItem = projectConfigMap.get(k);
        const globItem = globalConfigMap.get(k);

        if (projItem && projItem.configured && projItem.source === "package") {
          rawValue = projItem.value;
          source = "project";
        } else if (globItem && globItem.configured) {
          rawValue = globItem.value;
          source = "global";
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
        merged,
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
            `${projConfig.name} (${projConfig.id})`,
            filterRes.isFallback,
            effectiveIntent,
            reveal
          ),
        context,
      });
    } finally {
      await localTarget.close();
    }
  });

  // config get <key>
  configCmd
    .command("get <key>")
    .description("Get configuration value for key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Get from global configuration")
    .option("-p, --profile <name>", "Query config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--reveal, --show-secrets", "Reveal plain text values for secrets")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }
      const reveal = Boolean(options.reveal || options.showSecrets);

      // 1. 远端服务分支
      const target = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      if (target.type === "remote") {
        const remoteTarget = await createActionDockTarget({
          type: "remote",
          serverUrl: target.serverUrl!,
          token: target.token,
        });
        try {
          const res = await fetchRemoteConfig(target.serverUrl!, target.token, options.package);
          const val = res.values?.[key];
          const isSecret = isSecretConfigKey(key, res.declared?.[key]);
          const displayValue = !reveal && isSecret && val !== undefined ? maskSecretValue(val) : val;

          const payload = {
            key,
            value: displayValue,
            source: "remote",
            secret: isSecret,
          };

          renderResult(payload, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
            context,
          });
          return;
        } finally {
          await remoteTarget.close();
        }
      }

      // 2. 本地分支
      const root = resolvePackageRoot(options.package);
      const localTarget = await createActionDockTarget({
        type: "local",
        projectRoot: root || undefined,
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
      });

      try {
        if (options.global || !root) {
          if (!options.global && options.package && !root) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }

          const confView = await localTarget.getConfig("global", key);
          const val = confView?.value;
          const isSecret = confView?.secret ?? isSecretConfigKey(key);
          const displayValue = !reveal && isSecret && val !== undefined ? maskSecretValue(val) : val;

          const payload = {
            key,
            value: displayValue,
            source: "global",
            secret: isSecret,
          };

          renderResult(payload, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
            context,
          });
          return;
        }

        const projConfig = loadProjectConfig(root);
        const declaredItem = projConfig.config?.[key];
        const confView = await localTarget.getConfig(projConfig.id, key);

        let resolvedVal: unknown = confView?.value;
        let source: string = confView?.source === "package" ? "project" : (confView?.source || "default");
        const envResolved = resolveEnvValue(key, declaredItem, projConfig.id);

        if (confView && confView.configured) {
          resolvedVal = confView.value;
          source = confView.source === "package" ? "project" : confView.source;
        } else if (envResolved !== undefined) {
          resolvedVal = envResolved.value;
          source = "env";
        } else {
          resolvedVal = declaredItem?.default;
          source = "default";
        }

        const isSecret = confView?.secret ?? isSecretConfigKey(key, declaredItem);
        const displayValue = !reveal && isSecret && resolvedVal !== undefined ? maskSecretValue(resolvedVal) : resolvedVal;

        const payload = {
          key,
          value: displayValue,
          source,
          secret: isSecret,
        };

        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
          context,
        });
      } finally {
        await localTarget.close();
      }
    });

  // config set <key> [value]
  configCmd
    .command("set <key> [value]")
    .description("Set configuration value (supports stdin and secure prompt)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Set in global configuration")
    .option("-p, --profile <name>", "Configure on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--stdin", "Read value from standard input")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (key: string, rawVal: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }

      let root: string | null = null;
      let projConfig: any = null;
      let declaredDef: ConfigItemDefinition | undefined;

      if (!options.global && !options.profile && !options.server) {
        root = resolvePackageRoot(options.package);
        if (root) {
          try {
            projConfig = loadProjectConfig(root);
            declaredDef = projConfig.config?.[key];
          } catch {}
        }
      }

      const isSecret = isSecretConfigKey(key, declaredDef);

      let effectiveValueStr = rawVal;
      if (effectiveValueStr === undefined || options.stdin) {
        effectiveValueStr = await resolveConfigValueInput({
          promptText: `Enter value for '${key}'${isSecret ? " (secret)" : ""}: `,
          secret: isSecret,
          context,
          useStdin: Boolean(options.stdin),
        });
      }

      let parsedVal: unknown = effectiveValueStr;
      try {
        parsedVal = JSON.parse(effectiveValueStr);
      } catch {
        parsedVal = effectiveValueStr;
      }

      // 1. 目标解析与 Target 创建
      const resolved = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      const target = await createActionDockTarget(
        resolved.type === "remote"
          ? {
              type: "remote",
              serverUrl: resolved.serverUrl!,
              token: resolved.token,
            }
          : {
              type: "local",
              projectRoot: root || undefined,
              customHome: context?.customHome,
              dataDir: options.dataDir || context?.dataDir,
            }
      );

      try {
        if (resolved.type === "remote") {
          await target.setConfig(options.package || "", key, parsedVal as any);
          writeStdout(`[OK] Configuration '${key}' updated on remote server`, context);
          return;
        }

        if (options.global) {
          await target.setConfig("global", key, parsedVal as any);
          writeStdout(`[OK] Global configuration '${key}' updated`, context);
          return;
        }

        if (!root) {
          if (options.package) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          await target.setConfig("global", key, parsedVal as any);
          writeStdout(`[OK] Global configuration '${key}' updated (no project in current directory)`, context);
          return;
        }

        await target.setConfig(projConfig.id, key, parsedVal as any);
        writeStdout(`[OK] Configuration '${key}' updated for package '${projConfig.id}'`, context);
      } finally {
        await target.close();
      }
    });

  // config delete <key>
  configCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete configuration entry")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Delete from global configuration")
    .option("-p, --profile <name>", "Delete on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }

      const root = resolvePackageRoot(options.package);

      const resolved = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      const target = await createActionDockTarget(
        resolved.type === "remote"
          ? {
              type: "remote",
              serverUrl: resolved.serverUrl!,
              token: resolved.token,
            }
          : {
              type: "local",
              projectRoot: root || undefined,
              customHome: context?.customHome,
              dataDir: options.dataDir || context?.dataDir,
            }
      );

      try {
        if (resolved.type === "remote") {
          await target.deleteConfig(options.package || "", key);
          writeStdout(`[OK] Configuration '${key}' deleted from remote server`, context);
          return;
        }

        if (options.global) {
          await target.deleteConfig("global", key);
          writeStdout(`[OK] Global configuration '${key}' deleted`, context);
          return;
        }

        if (!root) {
          if (options.package) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          await target.deleteConfig("global", key);
          writeStdout(`[OK] Global configuration '${key}' deleted`, context);
          return;
        }

        const projConfig = loadProjectConfig(root);
        await target.deleteConfig(projConfig.id, key);
        writeStdout(`[OK] Configuration '${key}' deleted for package '${projConfig.id}'`, context);
      } finally {
        await target.close();
      }
    });

  // config env
  configCmd
    .command("env [identifier]")
    .description("Diagnose environment variable satisfaction for declared configuration")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (identifier: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const targetPkg = identifier || options.package;

      // 1. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const res = await fetchRemoteConfigEnv(target.serverUrl!, target.token, targetPkg);
        renderResult(res, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderConfigEnv(res.envChecks || [], res.packageId),
          context,
        });
        return;
      }

      // 2. 本地项目分支
      const root = resolvePackageRoot(targetPkg);
      if (!root) {
        if (targetPkg) {
          throw new ArgumentError(`Package '${targetPkg}' not found in linked packages or path`);
        }
        throw new ArgumentError(
          "Not in an ActionDock project.\nUsage: ad config env [package-id] or cd into a project directory."
        );
      }

      const projConfig = loadProjectConfig(root);
      const declared = projConfig.config || {};
      const envChecks: EnvCheckItem[] = [];

      for (const [key, itemDef] of Object.entries(declared)) {
        const resolved = resolveEnvValue(key, itemDef, projConfig.id);
        const hasDefault = itemDef.default !== undefined;
        const satisfied = resolved !== undefined || hasDefault;
        envChecks.push({
          key,
          required: Boolean(itemDef.required),
          satisfied,
          matchedEnv: resolved ? resolved.matchedKey : null,
          hasDefault,
          secret: isSecretConfigKey(key, itemDef),
        });
      }

      const allSatisfied = envChecks.every((c) => !c.required || c.satisfied);
      const payload = {
        packageId: projConfig.id,
        projectRoot: root,
        ok: allSatisfied,
        envChecks,
      };

      renderResult(payload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderConfigEnv(envChecks, projConfig.id),
        context,
      });

      if (!allSatisfied) {
        process.exitCode = 1;
      }
    });
}
