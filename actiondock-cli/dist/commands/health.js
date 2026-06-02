import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/command.js";
import { ActionDockClient } from "../lib/client.js";
import { resolveServerUrl, resolveToken } from "../lib/config.js";
export default class HealthCommand extends BaseCommand {
    static description = "Check ActionDock server health";
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
        const { flags } = await this.parse(HealthCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const health = await client.health();
            if (flags.json) {
                this.printJson(health);
                return;
            }
            this.log(`ActionDock server ${health.status ?? "UNKNOWN"} at ${health.server}`);
            if (!health.ok) {
                this.exit(5);
            }
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
