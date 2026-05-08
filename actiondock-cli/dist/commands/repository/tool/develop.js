import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderScriptDetail } from "../../../lib/render.js";
export default class RepositoryToolDevelopCommand extends BaseCommand {
    static description = "Sync a repository tool as a development script";
    static args = {
        repositoryId: Args.string({ required: true }),
        toolId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        "script-id": Flags.string({ description: "Development script ID override" }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(RepositoryToolDevelopCommand);
        try {
            const item = await createClient(flags).developRepositoryTool(args.repositoryId, args.toolId, flags["script-id"]);
            flags.json ? this.printJson(item) : this.log(renderScriptDetail(item, "draft"));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
