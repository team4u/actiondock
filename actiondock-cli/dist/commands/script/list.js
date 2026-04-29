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
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const scripts = await client.listScripts();
            const filtered = flags.all ? scripts : scripts.filter((item) => Boolean(item.publishedSnapshot));
            const items = filtered.map((item) => ({
                id: item.id,
                name: item.name,
                type: item.type,
                status: item.status,
                description: item.description,
                owner: item.owner,
                tags: item.tags ?? [],
                publishedSnapshot: item.publishedSnapshot ?? null
            }));
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderScriptList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
