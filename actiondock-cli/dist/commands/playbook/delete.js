import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
export default class PlaybookDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock playbook";
    static args = {
        "playbook-id": Args.string({ required: true, description: "Playbook ID" })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PlaybookDeleteCommand);
        try {
            await createClient(flags).deletePlaybook(args["playbook-id"]);
            flags.json ? this.printJson({ deleted: true, id: args["playbook-id"] }) : this.log(`Deleted playbook: ${args["playbook-id"]}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
