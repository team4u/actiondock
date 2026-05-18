import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPluginDetail } from "../../lib/render.js";
export default class PluginUpgradeCommand extends BaseCommand {
    static description = "Upgrade an ActionDock plugin from a local JAR";
    static args = {
        pluginId: Args.string({ required: true }),
        jarPath: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginUpgradeCommand);
        try {
            const plugin = await createClient(flags).upgradePlugin(args.pluginId, args.jarPath);
            flags.json ? this.printJson(plugin) : this.log(renderPluginDetail(plugin));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
