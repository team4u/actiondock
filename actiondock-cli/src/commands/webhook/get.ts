import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderWebhookDetail } from "../../lib/render.js";

export default class WebhookGetCommand extends BaseCommand {
  static description = "Show an ActionDock Webhook";

  static args = {
    webhookId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookGetCommand);

    try {
      const client = this.getClient(flags);
      const item = await client.webhooks.get(args.webhookId);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderWebhookDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
