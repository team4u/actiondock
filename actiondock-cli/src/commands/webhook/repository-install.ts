import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { renderRepositoryLocalAsset } from "../../lib/render.js";

export default class WebhookRepositoryInstallCommand extends BaseCommand {
  static description = "Install a repository Webhook";

  static args = {
    repositoryId: Args.string({ required: true }),
    webhookId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "install-script-dependencies": Flags.boolean({
      description: "Install or update referenced script dependencies",
      default: true
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookRepositoryInstallCommand);

    try {
      const client = this.getClient(flags);
      const result = await client.repositories.installWebhook(args.repositoryId, args.webhookId, {
        installSchedules: false,
        installScriptDependencies: flags["install-script-dependencies"]
      });

      if (flags.json) {
        this.printJson(result);
        return;
      }

      this.log(renderRepositoryLocalAsset(result));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
