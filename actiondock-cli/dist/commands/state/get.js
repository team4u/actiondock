import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderSharedStateDetail } from "../../lib/render.js";
export default class StateGetCommand extends BaseCommand {
    static description = "Show a shared-state entry";
    static args = {
        namespace: Args.string({ required: true }),
        key: Args.string({ required: true })
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
        const { args, flags } = await this.parse(StateGetCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const item = await client.getSharedState(args.namespace, args.key);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderSharedStateDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
