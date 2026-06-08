import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderRepositoryScriptDetail } from "../../lib/render.js";
export default class ScriptRepositoryGetCommand extends BaseCommand {
    static description = "Show a repository script";
    static args = {
        repositoryId: Args.string({ required: true }),
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptRepositoryGetCommand);
        try {
            const item = await this.getClient(flags).repositories.getScript(args.repositoryId, args.scriptId);
            flags.json ? this.printJson(item) : this.log(renderRepositoryScriptDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
