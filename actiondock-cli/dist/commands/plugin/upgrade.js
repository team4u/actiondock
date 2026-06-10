import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderPluginDetail } from "../../lib/render.js";
export default class PluginUpgradeCommand extends BaseCommand {
    static description = "Upgrade an ActionDock plugin from a local JAR";
    static args = {
        pluginId: Args.string({ required: true }),
        jarPath: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginUpgradeCommand);
        try {
            const plugin = await this.getClient(flags).plugins.upgrade(args.pluginId, args.jarPath);
            flags.json ? this.printJson(plugin) : this.log(renderPluginDetail(plugin));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
