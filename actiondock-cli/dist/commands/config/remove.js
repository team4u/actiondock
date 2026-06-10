import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { buildConfigListView, removeProfile } from "../../lib/config.js";
export default class ConfigRemoveCommand extends BaseCommand {
    static description = "Remove a CLI server profile";
    static args = {
        name: Args.string({ description: "profile name", required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ConfigRemoveCommand);
        try {
            const next = removeProfile(args.name);
            const view = buildConfigListView(next);
            if (flags.json) {
                this.printJson(view);
                return;
            }
            this.log(`Profile ${args.name} 已删除。`);
            if (!view.currentProfile) {
                this.log("Current profile: <not set>");
            }
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
