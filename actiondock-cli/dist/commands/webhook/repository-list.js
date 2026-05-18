import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderRepositoryWebhookList } from "../../lib/render.js";
export default class WebhookRepositoryListCommand extends BaseCommand {
    static description = "List repository Webhooks";
    static flags = {
        ...BaseCommand.baseFlags,
        repository: Flags.string({
            description: "Only show Webhooks from one repository"
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
    async run() {
        const { flags } = await this.parse(WebhookRepositoryListCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const items = flags.repository
                ? await client.listRepositoryWebhooksByRepository(flags.repository)
                : await client.listRepositoryWebhooks();
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderRepositoryWebhookList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
