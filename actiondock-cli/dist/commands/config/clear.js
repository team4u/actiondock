import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { buildConfigView, clearConfigValue } from "../../lib/config.js";
import { ActionDockCliError } from "../../lib/error.js";
export default class ConfigClearCommand extends BaseCommand {
    static description = "Clear a persisted configuration value";
    static args = {
        key: Args.string({ description: "server or token", required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        profile: Flags.string({
            description: "Profile to update"
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ConfigClearCommand);
        try {
            if (args.key !== "server" && args.key !== "token") {
                throw new ActionDockCliError("`config clear` 只支持 `server` 或 `token`。", 2);
            }
            const next = clearConfigValue(args.key === "server" ? "serverUrl" : "token", flags.profile);
            const view = buildConfigView(next, flags.profile);
            if (flags.json) {
                this.printJson(view);
                return;
            }
            this.log(`${args.key} 已从 profile ${view.profile} 清除。`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
