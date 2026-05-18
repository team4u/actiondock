import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderUpstreamStatus } from "../../lib/render.js";

export default class WebhookUpstreamStatusCommand extends BaseCommand {
  static description = "Show upstream sync status for an Webhook working copy";

  static examples = [
    "<%= config.bin %> <%= command.id %> webhook-source-copy",
    "<%= config.bin %> <%= command.id %> webhook-source-copy --json"
  ];

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
    const { args, flags } = await this.parse(WebhookUpstreamStatusCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const item = await client.getWebhookUpstreamStatus(args.webhookId);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderUpstreamStatus(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
