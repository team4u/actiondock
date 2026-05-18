import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class RepositoryKnowledgeGetCommand extends BaseCommand {
    static description = "Get knowledge entry details";
    static flags = {
        ...BaseCommand.baseFlags,
        "repository-id": Flags.string({ description: "Repository ID", required: true }),
        "knowledge-id": Flags.string({ description: "Knowledge entry ID", required: true }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(RepositoryKnowledgeGetCommand);
        try {
            const detail = await createClient(flags).getRepositoryKnowledge(flags["repository-id"], flags["knowledge-id"]);
            flags.json ? this.printJson(detail) : this.log(renderKnowledgeDetail(detail));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
function renderKnowledgeDetail(detail) {
    const d = detail.descriptor;
    const k = detail.knowledge;
    const lines = [
        `ID:          ${d.knowledgeId}`,
        `Name:        ${d.displayName}`,
        `Description: ${d.description ?? "-"}`,
        `Source:      ${k.source.type} - ${k.source.url}`,
        `Branch:      ${k.source.branch ?? "-"}`,
        `Entry:       ${k.source.entryPath ?? "ACTIONDOCK.md"}`,
        `Tags:        ${d.tags.join(", ") || "-"}`,
        `Installed:   ${d.installed}${d.installedRepositoryId ? ` (${d.installedRepositoryId})` : ""}`,
        `Trusted:     ${d.trusted}`,
    ];
    return lines.join("\n");
}
