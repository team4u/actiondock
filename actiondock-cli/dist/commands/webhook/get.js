import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderWebhookDetail } from "../../lib/render.js";
export default class WebhookGetCommand extends BaseCommand {
    static description = "Show an ActionDock Webhook";
    static args = {
        webhookId: Args.string({ required: true })
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
        const { args, flags } = await this.parse(WebhookGetCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const item = await client.getWebhook(args.webhookId);
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
