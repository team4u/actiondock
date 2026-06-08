import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
export default class RepositoryKnowledgeUninstallCommand extends BaseCommand {
    static description = "Uninstall a knowledge entry";
    static flags = {
        ...BaseCommand.baseFlags,
        "repository-id": Flags.string({ description: "Repository ID", required: true }),
        "knowledge-id": Flags.string({ description: "Knowledge entry ID", required: true }),
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(RepositoryKnowledgeUninstallCommand);
        try {
            await this.getClient(flags).repositories.uninstallKnowledge(flags["repository-id"], flags["knowledge-id"]);
            flags.json ? this.printJson({ success: true }) : this.log(`Knowledge "${flags["knowledge-id"]}" uninstalled`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
