import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderRepositoryLocalAsset } from "../../lib/render.js";

export default class WebhookRepositoryWorkingCopyCommand extends BaseCommand {
  static description = "Create a Webhook working copy from a repository Webhook";

  static examples = [
    "<%= config.bin %> <%= command.id %> demo-repo webhook-source",
    "<%= config.bin %> <%= command.id %> demo-repo webhook-source --webhook-id webhook-source-copy"
  ];

  static args = {
    repositoryId: Args.string({ required: true }),
    webhookId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "webhook-id": Flags.string({
      description: "Override the local working copy Webhook ID"
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

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookRepositoryWorkingCopyCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const item = await client.createRepositoryWebhookWorkingCopy(args.repositoryId, args.webhookId, flags["webhook-id"]);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderRepositoryLocalAsset(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
