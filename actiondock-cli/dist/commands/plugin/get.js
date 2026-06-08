import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderPluginDetail } from "../../lib/render.js";
export default class PluginGetCommand extends BaseCommand {
    static description = "Show an installed ActionDock plugin";
    static args = {
        pluginId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginGetCommand);
        try {
            const client = this.getClient(flags);
            const plugin = await client.plugins.get(args.pluginId);
            if (flags.json) {
                this.printJson({
                    ...plugin,
                    actions: plugin.actions.map(a => ({
                        action: a.action,
                        title: a.title,
                        description: a.description
                    }))
                });
                return;
            }
            this.log(renderPluginDetail(plugin));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
