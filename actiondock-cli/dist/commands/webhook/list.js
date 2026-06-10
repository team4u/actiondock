import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderWebhookList } from "../../lib/render.js";
export default class WebhookListCommand extends BaseCommand {
    static description = "List ActionDock Webhooks";
    static flags = {
        ...BaseCommand.baseFlags,
        intent: intentFlag,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(WebhookListCommand);
        try {
            const client = this.getClient(flags);
            const items = await listWithIntentFallback(flags.intent, (intent) => client.webhooks.list(intent));
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderWebhookList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
