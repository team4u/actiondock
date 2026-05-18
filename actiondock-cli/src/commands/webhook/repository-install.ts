import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
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
    const { args, flags } = await this.parse(WebhookRepositoryInstallCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const result = await client.installRepositoryWebhook(args.repositoryId, args.webhookId, {
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
