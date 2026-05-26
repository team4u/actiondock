import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { ActionDockCliError } from "../../lib/error.js";
import { renderPluginActionDetail } from "../../lib/render.js";
export default class PluginActionCommand extends BaseCommand {
    static description = "Show the full schema for a single plugin action";
    static args = {
        pluginId: Args.string({ required: true, description: "Plugin ID" }),
        action: Args.string({ required: true, description: "Action name" })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        profile: Flags.string({
            description: "Use a configured server profile"
        }),
        server: Flags.string({
            description: "Override ActionDock server URL"
        }),
        token: Flags.string({
            description: "Override ActionDock bearer token"
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginActionCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const plugin = await client.getPlugin(args.pluginId);
            const action = plugin.actions.find(a => a.action === args.action);
            if (!action) {
                const available = plugin.actions.map(a => a.action).join(", ");
                throw new ActionDockCliError(`插件 ${args.pluginId} 不存在动作 ${args.action}。可用: ${available}`, 2);
            }
            if (flags.json) {
                this.printJson(action);
                return;
            }
            this.log(renderPluginActionDetail(action));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
