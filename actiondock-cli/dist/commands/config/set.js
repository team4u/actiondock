import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { buildConfigView, normalizeServerUrl, readConfig, setConfigValue } from "../../lib/config.js";
import { ActionDockCliError } from "../../lib/error.js";
export default class ConfigSetCommand extends BaseCommand {
    static description = "Persist local CLI configuration";
    static args = {
        key: Args.string({ description: "server or token", required: true }),
        value: Args.string({ description: "value to store", required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ConfigSetCommand);
        try {
            if (args.key !== "server" && args.key !== "token") {
                throw new ActionDockCliError("`config set` 只支持 `server` 或 `token`。", 2);
            }
            const value = args.key === "server" ? normalizeServerUrl(args.value) : args.value.trim();
            if (!value) {
                throw new ActionDockCliError(`配置项 ${args.key} 不能为空。`, 2);
            }
            const next = setConfigValue(args.key === "server" ? "serverUrl" : "token", value);
            const view = buildConfigView(next);
            if (flags.json) {
                this.printJson(view);
                return;
            }
            this.log(`${args.key} 已保存。`);
            this.log(`Config file: ${buildConfigView(readConfig()).path}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
