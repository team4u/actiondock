import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderRepositoryWebhookDetail } from "../../lib/render.js";
export default class WebhookRepositoryGetCommand extends BaseCommand {
    static description = "Show a repository Webhook";
    static args = {
        repositoryId: Args.string({ required: true }),
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
    async run() {
        const { args, flags } = await this.parse(WebhookRepositoryGetCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const item = await client.getRepositoryWebhook(args.repositoryId, args.webhookId);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderRepositoryWebhookDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
