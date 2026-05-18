import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScriptDetail } from "../../lib/render.js";
export default class ScriptDiscardDraftCommand extends BaseCommand {
    static description = "Discard draft changes and restore the published snapshot";
    static args = {
        scriptId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        profile: Flags.string({
            description: "Use a configured server profile"
        }),
        server: Flags.string({
            description: "Override ActionDock server URL"
        }),
        token: Flags.string({
            description: "Override ActionDock bearer token"
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ScriptDiscardDraftCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const script = await client.discardDraft(args.scriptId);
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
