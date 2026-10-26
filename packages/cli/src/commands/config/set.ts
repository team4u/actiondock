import { loadProjectConfig } from "@actiondock/core";
import { assertConcreteConfigKey, resolveConfigDeclaration } from "@actiondock/core/project";
import { resolvePackageRoot } from "@actiondock/core/registry";
import type { Command } from "commander";
import { ArgumentError, ExecutionError, notInProjectError, packageNotFoundError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { applyTargetOptions, getEffectiveOptions, resolveTargetFromOptions, withService } from "../../utils";
import { addStoredValueOptions, splitStoredValueArgs } from "../../utils/value-input";
import { hasStoredValueInput, resolveStoredValue } from "../../services/value-input";
import { promptBrowserSecret } from "../../services/browser-secret-input";
import { resolveConfigValueInput } from "../../prompt";
import { resolveRemoteConfigScope } from "./remote-helper";

/** 输入先组装为完整值，声明校验和整键替换仍委托核心服务。 */
export function registerConfigSetCommand(
  configCmd: Command,
  context?: CliContext,
  promptBrowser: typeof promptBrowserSecret = promptBrowserSecret
): void {
  addStoredValueOptions(applyTargetOptions(
    configCmd.command("set <key> [values...]")
      .description("Replace configuration using a complete value, stdin, or flat assignments after '--'")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-g, --global", "Set in global configuration")
  ))
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--browser", "Enter secret configuration interactively via a local browser page")
    .addHelpText("after", "\nExamples:\n  ad config set KEY '{\"value\":1}'\n  ad config set KEY -- host=localhost port:=3306\n  ad config set KEY --stdin-field password -- host=localhost < password.txt\n  ad config set GITHUB_TOKEN -P my-pkg --browser\n  ad config set GITHUB_TOKEN --global --browser\n\nEach command replaces the complete value; existing fields are not merged.")
    .action(async (key: string, values: string[], rawOptions: any, cmd: Command) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      assertConcreteConfigKey(key);
      const input = {
        ...splitStoredValueArgs(cmd, values),
        fromStdin: Boolean(options.stdin),
        stdinField: options.stdinField,
      };

      if (options.browser) {
        if (
          Boolean(options.stdin) ||
          options.stdinField !== undefined ||
          input.value !== undefined ||
          input.flatArgs !== undefined
        ) {
          throw new ArgumentError(
            "'--browser' is mutually exclusive with positional values, '--stdin', '--stdin-field', and structured assignments after '--'."
          );
        }

        if (options.profile || options.server) {
          throw new ArgumentError(
            "'--browser' is only supported for local targets and cannot be used with remote targets."
          );
        }

        const resolvedTarget = resolveTargetFromOptions(options, context);
        if (resolvedTarget.type === "remote") {
          throw new ArgumentError(
            "'--browser' is only supported for local targets and cannot be used with remote targets."
          );
        }

        const isGlobal = Boolean(options.global);
        const root = !isGlobal
          ? resolvePackageRoot(options.package, undefined, context?.customHome)
          : null;

        if (!isGlobal) {
          if (options.package && !root) {
            throw packageNotFoundError(options.package);
          }
          if (!root) {
            throw notInProjectError("Please specify -P, --package <id> or cd into a package directory.");
          }
        }

        const scopeId = root ? loadProjectConfig(root).id : "global";
        const targetLabel = isGlobal
          ? "全局配置（可能影响多个包，同名包级配置优先）"
          : `包：${scopeId}`;
        const scopeDesc = isGlobal ? "global scope" : `package '${scopeId}'`;

        await withService(options, context, async (service) => {
          const configApi = service.management?.config;
          if (!configApi) {
            throw new ExecutionError("Configuration management service is unavailable.");
          }

          const packages = await service.discovery.listPackages();
          const matchingItems = packages
            .filter((pkg) => isGlobal || pkg.id === scopeId)
            .flatMap((pkg) => {
              const item = resolveConfigDeclaration(pkg.config, key)?.item;
              return item ? [item] : [];
            });

          const hasTopLevelSecret = matchingItems.some((item) => item.secret === true);
          if (!hasTopLevelSecret) {
            const scopeMsg = isGlobal ? "any loaded package" : `package '${scopeId}'`;
            throw new ArgumentError(
              `Configuration '${key}' is not declared as a secret in ${scopeMsg}. '--browser' only supports declared top-level secret configurations.`
            );
          }

          const hasNonString = matchingItems.some((item) => {
            const declType = item.type;
            const schemaType = item.schema?.type;
            return (
              (declType !== undefined && declType !== "string") ||
              (schemaType !== undefined && schemaType !== "string")
            );
          });

          if (hasNonString) {
            const scopeMsg = isGlobal ? "loaded package(s)" : `package '${scopeId}'`;
            throw new ArgumentError(
              `Configuration '${key}' is declared as a non-string type in ${scopeMsg}. '--browser' only supports string configurations.`
            );
          }

          await promptBrowser({
            targetLabel,
            key,
            signal: context?.control?.signal,
            context,
            onSubmit: async (secretValue: string) => {
              await configApi.set(scopeId, key, secretValue);
            },
          });

          writeStdout(`[OK] Configuration '${key}' updated for ${scopeDesc}`, context);
        }, { localRoot: root || undefined });
        return;
      }

      const explicit = hasStoredValueInput(input);
      const decoded = explicit ? await resolveStoredValue(input, context) : undefined;
      const root = !options.global && !options.profile && !options.server
        ? resolvePackageRoot(options.package) : null;
      await withService(options, context, async (service, target) => {
        if (target.type !== "remote" && !options.global && options.package && !root) {
          throw packageNotFoundError(options.package);
        }
        const packageId = target.type === "remote"
          ? resolveRemoteConfigScope(options).packageId || ""
          : options.global || !root ? "global" : loadProjectConfig(root).id;
        let value = decoded;
        if (!explicit) {
          value = await resolveStoredValue(input, context, async () => {
            const secret = Boolean((await service.management?.config.get(packageId, key))?.secret);
            return resolveConfigValueInput({
              promptText: `Enter value for '${key}'${secret ? " (secret)" : ""}: `,
              secret,
              context,
            });
          });
        }
        if (value === undefined) throw new ArgumentError("A configuration value is required.");
        context?.control?.signal?.throwIfAborted();
        await service.management?.config.set(packageId, key, value);
        const scope = target.type === "remote" ? "remote server"
          : packageId === "global" ? "global scope" : `package '${packageId}'`;
        writeStdout(`[OK] Configuration '${key}' updated for ${scope}`, context);
      }, { localRoot: root || undefined });
    });
}
