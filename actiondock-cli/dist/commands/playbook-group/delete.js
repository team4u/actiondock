import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class PlaybookGroupDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock playbook group";
    static args = {
        "group-id": Args.string({ required: true, description: "Playbook group ID" })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PlaybookGroupDeleteCommand);
        try {
            await createClient(flags).deletePlaybookGroup(args["group-id"]);
            flags.json ? this.printJson({ deleted: true, id: args["group-id"] }) : this.log(`Deleted playbook group: ${args["group-id"]}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
