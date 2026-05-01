import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderEventRecordList } from "../../lib/render.js";
export default class EventRecordListCommand extends BaseCommand {
    static description = "List ActionDock event records";
    static flags = {
        ...BaseCommand.baseFlags,
        "source-id": Flags.string({
            description: "Filter by event source ID"
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
        const { flags } = await this.parse(EventRecordListCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const items = await client.listEventRecords(flags["source-id"]);
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderEventRecordList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
