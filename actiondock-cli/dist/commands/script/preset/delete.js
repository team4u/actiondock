import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
export default class ScriptPresetDeleteCommand extends BaseCommand {
    static description = "Delete a script execution preset";
    static args = {
        scriptId: Args.string({ required: true }),
        presetId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptPresetDeleteCommand);
        try {
            await createClient(flags).deleteExecutionPreset(args.scriptId, args.presetId);
            flags.json ? this.printJson({ deleted: true, scriptId: args.scriptId, presetId: args.presetId }) : this.log(`执行参数预设已删除: ${args.presetId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
