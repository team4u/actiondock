import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderRepositoryToolList } from "../../lib/render.js";
export default class ScriptRepositoryListCommand extends BaseCommand {
    static description = "List repository scripts";
    static flags = {
        ...BaseCommand.baseFlags,
        repository: Flags.string({ description: "Filter by repository ID" }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(ScriptRepositoryListCommand);
        try {
            const items = await createClient(flags).listRepositoryTools(flags.repository);
            flags.json ? this.printJson(items) : this.log(renderRepositoryToolList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
