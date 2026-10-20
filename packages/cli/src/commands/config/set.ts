import { loadProjectConfig } from "@actiondock/core";
import { assertConcreteConfigKey } from "@actiondock/core/project";
import { resolvePackageRoot } from "@actiondock/core/registry";
import type { Command } from "commander";
import { ArgumentError, packageNotFoundError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { applyTargetOptions, getEffectiveOptions, withService } from "../../utils";
import { addStoredValueOptions, splitStoredValueArgs } from "../../utils/value-input";
import { hasStoredValueInput, resolveStoredValue } from "../../services/value-input";
import { resolveConfigValueInput } from "../../prompt";
import { resolveRemoteConfigScope } from "./remote-helper";

/** 输入先组装为完整值，声明校验和整键替换仍委托核心服务。 */
export function registerConfigSetCommand(configCmd: Command, context?: CliContext): void {
  addStoredValueOptions(applyTargetOptions(
    configCmd.command("set <key> [values...]")
      .description("Replace configuration using a complete value, stdin, or flat assignments after '--'")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-g, --global", "Set in global configuration")
  ))
    .option("--data-dir <path>", "Custom database storage directory")
    .addHelpText("after", "\nExamples:\n  ad config set KEY '{\"value\":1}'\n  ad config set KEY -- host=localhost port:=3306\n  ad config set KEY --stdin-field password -- host=localhost < password.txt\n\nEach command replaces the complete value; existing fields are not merged.")
    .action(async (key: string, values: string[], rawOptions: any, cmd: Command) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      assertConcreteConfigKey(key);
      const input = {
        ...splitStoredValueArgs(cmd, values),
        fromStdin: Boolean(options.stdin),
        stdinField: options.stdinField,
      };
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
