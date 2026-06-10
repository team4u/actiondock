import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { mergeWebhookDefinition, parseDefinitionInput, resolveEnabledFlag } from "../../lib/webhook.js";
import { renderWebhookDetail } from "../../lib/render.js";

export default class WebhookCreateCommand extends BaseCommand {
  static description = "Create an ActionDock Webhook";

  static flags = {
    ...BaseCommand.baseFlags,
    "definition-json": Flags.string({
      description: "Inline JSON object for the Webhook definition",
      required: true
    }),
    "definition-file": Flags.string({
      description: "Path to a JSON file containing the Webhook definition"
    }),
    "webhook-id": Flags.string({
      description: "Webhook ID override"
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
      description: "Create the Webhook as enabled"
    }),
    disabled: Flags.boolean({
      description: "Create the Webhook as disabled"
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WebhookCreateCommand);

    try {
      const client = this.getClient(flags);
      const definition = mergeWebhookDefinition(
        parseDefinitionInput(flags["definition-json"], flags["definition-file"], {
          jsonFlag: "`--definition-json`",
          fileFlag: "`--definition-file`"
        }),
        {
          id: flags["webhook-id"],
          name: flags.name,
          key: flags.key,
          description: flags.description,
          enabled: resolveEnabledFlag({
            enabledFlag: flags.enabled,
            disabledFlag: flags.disabled
          }),
          transportType: flags["transport-type"]?.toUpperCase()
        }
      );
      const item = await client.webhooks.create(definition);

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
