import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderWebhookDetail } from "../../lib/render.js";
export default class WebhookUpstreamPullCommand extends BaseCommand {
    static description = "Pull upstream updates into an Webhook working copy";
    static examples = [
        "<%= config.bin %> <%= command.id %> webhook-source-copy",
        "<%= config.bin %> <%= command.id %> webhook-source-copy --force"
    ];
    static args = {
        webhookId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        force: Flags.boolean({
            description: "Overwrite local changes when pulling",
            default: false
        }),
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
        const { args, flags } = await this.parse(WebhookUpstreamPullCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const item = await client.pullUpstreamWebhook(args.webhookId, flags.force);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderWebhookDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
