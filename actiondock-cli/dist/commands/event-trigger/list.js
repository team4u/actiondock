import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventTriggerList } from "../../lib/render.js";
export default class EventTriggerListCommand extends BaseCommand {
    static description = "List ActionDock event triggers";
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
        const { flags } = await this.parse(EventTriggerListCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const items = await client.listEventTriggers();
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderEventTriggerList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
