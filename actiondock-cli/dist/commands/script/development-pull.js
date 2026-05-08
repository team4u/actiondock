import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderScriptDetail } from "../../lib/render.js";
export default class ScriptDevelopmentPullCommand extends BaseCommand {
    static description = "Pull repository updates into a development script";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        force: Flags.boolean({
            description: "Force pull even when local changes exist"
        }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptDevelopmentPullCommand);
        try {
            const script = await createClient(flags).pullDevelopmentScript(args.scriptId, flags.force);
            flags.json ? this.printJson(script) : this.log(renderScriptDetail(script, "draft"));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
