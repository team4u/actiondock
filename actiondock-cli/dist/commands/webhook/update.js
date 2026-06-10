import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { mergeDefinitionPatch, mergeWebhookDefinition, parseOptionalObject, resolveEnabledFlag } from "../../lib/webhook.js";
import { renderWebhookDetail } from "../../lib/render.js";
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
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(WebhookUpdateCommand);
        try {
            const client = this.getClient(flags);
            const existing = await client.webhooks.get(args.webhookId);
            const patch = parseOptionalObject(flags["definition-json"], flags["definition-file"], {
                jsonFlag: "`--definition-json`",
                fileFlag: "`--definition-file`"
            }) ?? {};
            const merged = mergeWebhookDefinition(mergeDefinitionPatch(existing, patch), {
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
            });
            const item = await client.webhooks.update(args.webhookId, merged);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderWebhookDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
