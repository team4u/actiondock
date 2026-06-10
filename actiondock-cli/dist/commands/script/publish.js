import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderScriptDetail } from "../../lib/render.js";
export default class ScriptPublishCommand extends BaseCommand {
    static description = "Publish an ActionDock draft script";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptPublishCommand);
        try {
            const client = this.getClient(flags);
            const script = await client.scripts.publish(args.scriptId);
            if (flags.json) {
                this.printJson(script);
                return;
            }
            this.log(renderScriptDetail(script, "draft"));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
