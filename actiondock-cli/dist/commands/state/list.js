import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderSharedStateList } from "../../lib/render.js";
export default class StateListCommand extends BaseCommand {
    static description = "List shared-state entries in a namespace";
    static args = {
        namespace: Args.string({ required: true })
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
        const { args, flags } = await this.parse(StateListCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const items = await client.listSharedState(args.namespace);
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderSharedStateList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
