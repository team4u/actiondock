import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderPluginDetail } from "../../lib/render.js";
export default class PluginStopCommand extends BaseCommand {
    static description = "Stop an ActionDock plugin";
    static args = {
        pluginId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginStopCommand);
        try {
            const plugin = await this.getClient(flags).plugins.stop(args.pluginId);
            flags.json ? this.printJson(plugin) : this.log(renderPluginDetail(plugin));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
