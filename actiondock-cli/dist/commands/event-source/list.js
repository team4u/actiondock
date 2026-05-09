import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventSourceList } from "../../lib/render.js";
export default class EventSourceListCommand extends BaseCommand {
    static description = "List ActionDock event sources";
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
        const { flags } = await this.parse(EventSourceListCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const items = await client.listEventSources();
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderEventSourceList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
