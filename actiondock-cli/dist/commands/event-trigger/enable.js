import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventTriggerDetail } from "../../lib/render.js";
export default class EventTriggerEnableCommand extends BaseCommand {
    static description = "Enable an ActionDock event trigger";
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
        const { args, flags } = await this.parse(EventTriggerEnableCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const item = await client.enableEventTrigger(args.triggerId);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderEventTriggerDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
