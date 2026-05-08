import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class PluginUninstallCommand extends BaseCommand {
    static description = "Uninstall an ActionDock plugin";
    static args = {
        pluginId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        force: Flags.boolean({ description: "Force uninstall" }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginUninstallCommand);
        try {
            await createClient(flags).uninstallPlugin(args.pluginId, flags.force);
            flags.json ? this.printJson({ deleted: true, pluginId: args.pluginId }) : this.log(`插件已卸载: ${args.pluginId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
