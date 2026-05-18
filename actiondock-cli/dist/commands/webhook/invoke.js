import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { parseWebhookRequest } from "../../lib/event.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderWebhookInvokeResult } from "../../lib/render.js";
export default class WebhookInvokeCommand extends BaseCommand {
    static description = "Invoke an ActionDock webhook endpoint";
    static args = {
        webhookId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        "payload-json": Flags.string({
            description: "Inline JSON object for the incoming Webhook payload"
        }),
        "payload-file": Flags.string({
            description: "Path to a JSON file containing the incoming Webhook payload"
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
        const { args, flags } = await this.parse(WebhookInvokeCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const result = await client.invokeWebhook(args.webhookId, parseWebhookRequest(flags["payload-json"], flags["payload-file"]));
            if (flags.json) {
                this.printJson(result);
                return;
            }
            this.log(renderWebhookInvokeResult(result));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
