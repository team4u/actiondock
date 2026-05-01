import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
export default class EventTriggerDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock event trigger";
    static args = {
        triggerId: Args.string({ required: true })
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
        const { args, flags } = await this.parse(EventTriggerDeleteCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            await client.deleteEventTrigger(args.triggerId);
            if (flags.json) {
                this.printJson({ deleted: true, triggerId: args.triggerId });
                return;
            }
            this.log(`已删除事件触发器: ${args.triggerId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
