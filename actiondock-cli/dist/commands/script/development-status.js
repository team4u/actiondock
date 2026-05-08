import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderDevelopmentStatus } from "../../lib/render.js";
export default class ScriptDevelopmentStatusCommand extends BaseCommand {
    static description = "Show repository development sync status for a script";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptDevelopmentStatusCommand);
        try {
            const item = await createClient(flags).getScriptDevelopmentStatus(args.scriptId);
            flags.json ? this.printJson(item) : this.log(renderDevelopmentStatus(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
