import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class RepositoryKnowledgeListCommand extends BaseCommand {
    static description = "List knowledge entries in repositories";
    static flags = {
        ...BaseCommand.baseFlags,
        "repository-id": Flags.string({ description: "Filter by repository ID" }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(RepositoryKnowledgeListCommand);
        try {
            const items = await createClient(flags).listRepositoryKnowledge(flags["repository-id"]);
            flags.json ? this.printJson(items) : this.log(renderKnowledgeList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
function renderKnowledgeList(items) {
    if (items.length === 0)
        return "No knowledge entries found.";
    const rows = items.map(k => `  ${k.knowledgeId.padEnd(25)} ${k.displayName.padEnd(20)} ${k.source.type.padEnd(10)} ${k.installed ? "INSTALLED" : "available"} ${k.trusted ? "TRUSTED" : ""}`);
    return ["ID                         Name                 Source     Status", ...rows].join("\n");
}
