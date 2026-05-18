import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class ScriptDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock script";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptDeleteCommand);
        try {
            await createClient(flags).deleteScript(args.scriptId);
            flags.json ? this.printJson({ deleted: true, id: args.scriptId }) : this.log(`脚本已删除: ${args.scriptId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
