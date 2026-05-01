import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventSourceDetail } from "../../lib/render.js";
export default class EventSourceEnableCommand extends BaseCommand {
    static description = "Enable an ActionDock event source";
    static args = {
        sourceId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        server: Flags.string({
            description: "Override ActionDock server URL"
        }),
        token: Flags.string({
            description: "Override ActionDock bearer token"
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(EventSourceEnableCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const item = await client.enableEventSource(args.sourceId);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderEventSourceDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
