import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScriptList } from "../../lib/render.js";
export default class ScriptListCommand extends BaseCommand {
    static description = "List available ActionDock scripts";
    static flags = {
        ...BaseCommand.baseFlags,
        all: Flags.boolean({
            description: "Include draft-only scripts"
        }),
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
        const { flags } = await this.parse(ScriptListCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const scripts = await client.listScripts();
            const filtered = flags.all ? scripts : scripts.filter((item) => Boolean(item.publication?.published));
            const items = filtered.map((item) => ({
                id: item.id,
                name: item.name ?? null,
                type: item.type ?? null,
                published: Boolean(item.publication?.published)
            }));
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderScriptList(filtered));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
