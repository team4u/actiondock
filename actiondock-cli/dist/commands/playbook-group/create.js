import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, readDefinitionFile, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPlaybookGroupDetail } from "../../lib/render.js";
export default class PlaybookGroupCreateCommand extends BaseCommand {
    static description = "Create an ActionDock playbook group from a definition file";
    static flags = {
        ...BaseCommand.baseFlags,
        "definition-file": Flags.string({ description: "Path to playbook group JSON definition", required: true }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(PlaybookGroupCreateCommand);
        try {
            const item = await createClient(flags).createPlaybookGroup(readDefinitionFile(flags["definition-file"]));
            flags.json ? this.printJson(item) : this.log(renderPlaybookGroupDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
