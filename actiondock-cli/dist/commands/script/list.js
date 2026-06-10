import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderScriptList } from "../../lib/render.js";
export default class ScriptListCommand extends BaseCommand {
    static description = "List available ActionDock scripts";
    static flags = {
        ...BaseCommand.baseFlags,
        all: Flags.boolean({
            description: "Include draft-only scripts"
        }),
        intent: intentFlag,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(ScriptListCommand);
        try {
            const client = this.getClient(flags);
            const scripts = await listWithIntentFallback(flags.intent, (intent) => client.scripts.list(intent));
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
