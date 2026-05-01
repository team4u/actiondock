import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
export default class EventSourceDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock event source";
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
        const { args, flags } = await this.parse(EventSourceDeleteCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            await client.deleteEventSource(args.sourceId);
            if (flags.json) {
                this.printJson({ deleted: true, sourceId: args.sourceId });
                return;
            }
            this.log(`已删除事件源: ${args.sourceId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
