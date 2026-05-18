import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";

export default class WebhookDeleteCommand extends BaseCommand {
  static description = "Delete an ActionDock Webhook";

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

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookDeleteCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      await client.deleteWebhook(args.webhookId);

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
