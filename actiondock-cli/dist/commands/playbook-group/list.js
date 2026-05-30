import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPlaybookGroupList } from "../../lib/render.js";
export default class PlaybookGroupListCommand extends BaseCommand {
    static description = "List ActionDock playbook groups";
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(PlaybookGroupListCommand);
        try {
            const items = await createClient(flags).listPlaybookGroups();
            flags.json ? this.printJson(items) : this.log(renderPlaybookGroupList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
