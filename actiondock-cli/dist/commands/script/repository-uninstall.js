import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class ScriptRepositoryUninstallCommand extends BaseCommand {
    static description = "Uninstall an installed repository script by script ID";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptRepositoryUninstallCommand);
        try {
            await createClient(flags).uninstallRepositoryTool(args.scriptId);
            flags.json ? this.printJson({ uninstalled: true, scriptId: args.scriptId }) : this.log(`仓库脚本已卸载: ${args.scriptId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
