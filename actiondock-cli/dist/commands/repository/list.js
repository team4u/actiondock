import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, intentFlag, listWithIntentFallback, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderRepositoryList } from "../../lib/render.js";
export default class RepositoryListCommand extends BaseCommand {
    static description = "List ActionDock repositories";
    static flags = {
        ...BaseCommand.baseFlags,
        purpose: Flags.string({ description: "Repository purpose", options: ["capability", "project"] }),
        intent: intentFlag,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(RepositoryListCommand);
        try {
            const client = createClient(flags);
            const purpose = flags.purpose?.toUpperCase();
            const items = await listWithIntentFallback(flags.intent, (intent) => client.listRepositories(purpose, intent));
            flags.json ? this.printJson(items) : this.log(renderRepositoryList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
