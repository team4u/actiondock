import { loadProjectConfig } from "@actiondock/core";
import { assertConcreteConfigKey } from "@actiondock/core/project";
import { resolvePackageRoot } from "@actiondock/core/registry";
import type { Command } from "commander";
import { packageNotFoundError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { applyTargetOptions, getEffectiveOptions, withService } from "../../utils";
import { resolveConfigValueInput } from "../../prompt";
import { resolveRemoteConfigScope } from "./remote-helper";

/** 完整替换配置键；校验和敏感性识别均委托核心服务。 */
export function registerConfigSetCommand(configCmd: Command, context?: CliContext): void {
  applyTargetOptions(
    configCmd.command("set <key> [value]")
      .description("Set configuration value (supports stdin and secure prompt)")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-g, --global", "Set in global configuration")
  )
    .option("--stdin", "Read value from standard input")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (key: string, rawValue: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      assertConcreteConfigKey(key);
      const root = !options.global && !options.profile && !options.server
        ? resolvePackageRoot(options.package) : null;
      await withService(options, context, async (service, target) => {
        if (target.type !== "remote" && !options.global && options.package && !root) {
          throw packageNotFoundError(options.package);
        }
        const packageId = target.type === "remote"
          ? resolveRemoteConfigScope(options).packageId || ""
          : options.global || !root ? "global" : loadProjectConfig(root).id;
        let input = rawValue;
        if (input === undefined || options.stdin) {
          // 提示前查询安全元数据，覆盖模板、全局聚合与远端声明，不读取任何秘密原文。
          const secret = !options.stdin && Boolean((await service.management?.config.get(packageId, key))?.secret);
          input = await resolveConfigValueInput({
            promptText: `Enter value for '${key}'${secret ? " (secret)" : ""}: `,
            secret,
            context,
            useStdin: Boolean(options.stdin),
          });
        }
        let value: unknown = input;
        try { value = JSON.parse(input); } catch { /* 非 JSON 输入保留现有字符串语义。 */ }
        await service.management?.config.set(packageId, key, value as any);
        const scope = target.type === "remote" ? "remote server"
          : packageId === "global" ? "global scope" : `package '${packageId}'`;
        writeStdout(`[OK] Configuration '${key}' updated for ${scope}`, context);
      }, { localRoot: root || undefined });
    });
}
