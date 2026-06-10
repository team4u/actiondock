import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderWebhookDetail } from "../../lib/render.js";
export default class WebhookDisableCommand extends BaseCommand {
    static description = "Disable an ActionDock Webhook";
    static args = {
        webhookId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(WebhookDisableCommand);
        try {
            const client = this.getClient(flags);
            const item = await client.webhooks.disable(args.webhookId);
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
