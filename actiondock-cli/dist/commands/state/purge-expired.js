import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
export default class StatePurgeExpiredCommand extends BaseCommand {
    static description = "Purge expired shared-state entries";
    static args = {
        namespace: Args.string({ required: false })
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
        const { args, flags } = await this.parse(StatePurgeExpiredCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const count = await client.purgeExpiredSharedState(args.namespace);
            if (flags.json) {
                this.printJson({ purged: count, namespace: args.namespace ?? null });
                return;
            }
            this.log(`已清理 ${count} 条过期共享状态。`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
