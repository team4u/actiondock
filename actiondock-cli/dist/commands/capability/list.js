import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderCapabilityList } from "../../lib/render.js";
export default class CapabilityListCommand extends BaseCommand {
    static description = "List available ActionDock capabilities";
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
        const { flags } = await this.parse(CapabilityListCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const items = await client.listCapabilities();
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderCapabilityList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
