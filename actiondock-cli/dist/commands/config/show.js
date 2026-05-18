import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { buildConfigView, readConfig } from "../../lib/config.js";
export default class ConfigShowCommand extends BaseCommand {
    static description = "Show local CLI configuration";
    static flags = {
        ...BaseCommand.baseFlags,
        profile: Flags.string({
            description: "Profile to show"
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(ConfigShowCommand);
        const view = buildConfigView(readConfig(), flags.profile);
        if (flags.json) {
            this.printJson(view);
            return;
        }
        this.log([
            `Config file: ${view.path}`,
            `Current profile: ${view.currentProfile ?? "<not set>"}`,
            `Profile: ${view.profile ?? "<not set>"}`,
            `Server: ${view.serverUrl ?? "<not set>"}`,
            `Token: ${view.tokenConfigured ? "configured" : "<not set>"}`
        ].join("\n"));
    }
}
