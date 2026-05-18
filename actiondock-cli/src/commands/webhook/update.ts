import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import {
  mergeDefinitionPatch,
  mergeWebhookDefinition,
  parseOptionalObject,
  resolveEnabledFlag
} from "../../lib/event.js";
import { renderWebhookDetail } from "../../lib/render.js";
import type { WebhookDefinition } from "../../lib/types.js";

export default class WebhookUpdateCommand extends BaseCommand {
  static description = "Update an ActionDock Webhook";

  static args = {
    webhookId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "definition-json": Flags.string({
      description: "Inline JSON object merged into the saved Webhook definition"
    }),
    "definition-file": Flags.string({
      description: "Path to a JSON file merged into the saved Webhook definition"
    }),
    name: Flags.string({
      description: "Webhook name override"
    }),
    key: Flags.string({
      description: "Webhook key override"
    }),
    description: Flags.string({
      description: "Webhook description override"
    }),
    "transport-type": Flags.string({
      description: "Transport type override"
    }),
    enabled: Flags.boolean({
      description: "Mark the Webhook as enabled"
    }),
    disabled: Flags.boolean({
      description: "Mark the Webhook as disabled"
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
    const { args, flags } = await this.parse(WebhookUpdateCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const existing = await client.getWebhook(args.webhookId);
      const patch = parseOptionalObject<WebhookDefinition>(flags["definition-json"], flags["definition-file"], {
        jsonFlag: "`--definition-json`",
        fileFlag: "`--definition-file`"
      }) ?? {};
      const merged = mergeWebhookDefinition(
        mergeDefinitionPatch(existing, patch),
        {
          id: args.webhookId,
          name: flags.name,
          key: flags.key,
          description: flags.description,
          enabled: resolveEnabledFlag({
            enabledFlag: flags.enabled,
            disabledFlag: flags.disabled,
            fallback: existing.enabled
          }),
          transportType: flags["transport-type"]?.toUpperCase()
        }
      );
      const item = await client.updateWebhook(args.webhookId, merged);

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
