import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderProjectRepositoryResolution } from "../../lib/render.js";
export default class RepositoryResolveCommand extends BaseCommand {
    static description = "Resolve an ActionDock project repository and read its PROJECT.md";
    static flags = {
        ...BaseCommand.baseFlags,
        project: Flags.string({ description: "Project repository id", required: true }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(RepositoryResolveCommand);
        try {
            const item = await createClient(flags).resolveProjectRepository(flags.project);
            flags.json ? this.printJson(item) : this.log(renderProjectRepositoryResolution(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
