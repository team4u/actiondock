import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderRepositoryList } from "../../lib/render.js";
export default class RepositoryListCommand extends BaseCommand {
    static description = "List ActionDock repositories";
    static flags = {
        ...BaseCommand.baseFlags,
        purpose: Flags.string({ description: "Repository purpose", options: ["capability", "project"] }),
        intent: intentFlag,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(RepositoryListCommand);
        try {
            const client = this.getClient(flags);
            const purpose = flags.purpose?.toUpperCase();
            const items = await listWithIntentFallback(flags.intent, (intent) => client.repositories.list(purpose, intent));
            flags.json ? this.printJson(items) : this.log(renderRepositoryList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
