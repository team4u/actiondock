import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderRepositoryWebhookDetail } from "../../lib/render.js";

export default class WebhookRepositoryGetCommand extends BaseCommand {
  static description = "Show a repository Webhook";

  static args = {
    repositoryId: Args.string({ required: true }),
    webhookId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookRepositoryGetCommand);

    try {
      const client = this.getClient(flags);
      const item = await client.repositories.getWebhook(args.repositoryId, args.webhookId);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderRepositoryWebhookDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
