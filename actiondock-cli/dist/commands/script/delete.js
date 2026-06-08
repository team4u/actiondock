import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
export default class ScriptDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock script";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptDeleteCommand);
        try {
            await this.getClient(flags).scripts.delete(args.scriptId);
            flags.json ? this.printJson({ deleted: true, id: args.scriptId }) : this.log(`脚本已删除: ${args.scriptId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
