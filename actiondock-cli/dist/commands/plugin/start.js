import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPluginDetail } from "../../lib/render.js";
export default class PluginStartCommand extends BaseCommand {
    static description = "Start an ActionDock plugin";
    static args = {
        pluginId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginStartCommand);
        try {
            const plugin = await createClient(flags).startPlugin(args.pluginId);
            flags.json ? this.printJson(plugin) : this.log(renderPluginDetail(plugin));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
