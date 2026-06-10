import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderScriptDetail } from "../../lib/render.js";
export default class ScriptUpstreamPullCommand extends BaseCommand {
    static description = "Pull upstream updates into a script working copy";
    static examples = [
        "<%= config.bin %> <%= command.id %> hello-groovy-copy",
        "<%= config.bin %> <%= command.id %> hello-groovy-copy --force"
    ];
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        force: Flags.boolean({
            description: "Force pull even when local changes exist"
        }),
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptUpstreamPullCommand);
        try {
            const script = await this.getClient(flags).scripts.pullUpstream(args.scriptId, flags.force);
            flags.json ? this.printJson(script) : this.log(renderScriptDetail(script, "draft"));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
