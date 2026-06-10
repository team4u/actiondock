import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { parseWebhookRequest } from "../../lib/webhook.js";
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
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(WebhookInvokeCommand);
        try {
            const client = this.getClient(flags);
            const result = await client.webhooks.invoke(args.webhookId, parseWebhookRequest(flags["payload-json"], flags["payload-file"]));
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
