import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderRepositoryWebhookList } from "../../lib/render.js";

export default class WebhookRepositoryListCommand extends BaseCommand {
  static description = "List repository Webhooks";

  static flags = {
    ...BaseCommand.baseFlags,
    repository: Flags.string({
      description: "Only show Webhooks from one repository"
    }),
    intent: intentFlag,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WebhookRepositoryListCommand);

    try {
      const client = this.getClient(flags);
      const items = await listWithIntentFallback(flags.intent, (intent) =>
        flags.repository
          ? client.repositories.listWebhooksByRepository(flags.repository, intent)
          : client.repositories.listWebhooks(intent)
      );

      if (flags.json) {
        this.printJson(items);
        return;
      }

      this.log(renderRepositoryWebhookList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
