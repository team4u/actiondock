import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderPluginList } from "../../lib/render.js";
export default class PluginReferencesCommand extends BaseCommand {
    static description = "List plugin references available to scripts";
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(PluginReferencesCommand);
        try {
            const client = this.getClient(flags);
            const items = await client.plugins.listReferences();
            if (flags.json) {
                this.printJson(items.map(item => ({
                    ...item,
                    actions: item.actions.map(a => ({
                        action: a.action,
                        title: a.title,
                        description: a.description
                    }))
                })));
                return;
            }
            this.log(renderPluginList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
