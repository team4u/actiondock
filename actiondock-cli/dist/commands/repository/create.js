import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderRepositoryDetail } from "../../lib/render.js";
export default class RepositoryCreateCommand extends BaseCommand {
    static description = "Create an ActionDock repository";
    static flags = {
        ...BaseCommand.baseFlags,
        "repository-id": Flags.string({ description: "Repository ID", required: true }),
        name: Flags.string({ description: "Repository name", required: true }),
        type: Flags.string({ description: "Repository type", options: ["git", "local-dir"], required: true }),
        purpose: Flags.string({ description: "Repository purpose", options: ["capability", "project"], default: "capability" }),
        url: Flags.string({ description: "Repository URL or local path", required: true }),
        branch: Flags.string({ description: "Git branch" }),
        "trust-level": Flags.string({ description: "Repository trust level", options: ["trusted", "untrusted"], default: "untrusted" }),
        description: Flags.string({ description: "Repository description" }),
        disabled: Flags.boolean({ description: "Create repository as disabled" }),
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(RepositoryCreateCommand);
        try {
            const isProject = flags.purpose === "project";
            const item = await this.getClient(flags).repositories.create({
                id: flags["repository-id"],
                name: flags.name,
                type: flags.type.toUpperCase().replace("-", "_"),
                url: flags.url,
                branch: flags.branch,
                trustLevel: flags["trust-level"].toUpperCase().replace("-", "_"),
                description: flags.description,
                enabled: !flags.disabled,
                purpose: isProject ? "PROJECT" : undefined
            });
            flags.json ? this.printJson(item) : this.log(renderRepositoryDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
