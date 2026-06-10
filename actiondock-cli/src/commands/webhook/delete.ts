import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";

export default class WebhookDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock Webhook";

  static args = {
    webhookId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookDeleteCommand);

    try {
      const client = this.getClient(flags);
      await client.webhooks.delete(args.webhookId);

      if (flags.json) {
        this.printJson({ deleted: true, webhookId: args.webhookId });
        return;
      }

      this.log(`已删除Webhook: ${args.webhookId}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
