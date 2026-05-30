import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderPlaybookGuide } from "../../lib/render.js";
export default class PlaybookGuideCommand extends BaseCommand {
    static description = "Show a playbook guide view";
    static args = {
        "playbook-id": Args.string({ required: true, description: "Playbook ID" })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PlaybookGuideCommand);
        try {
            const item = await createClient(flags).getPlaybookGuide(args["playbook-id"]);
            flags.json ? this.printJson(item) : this.log(renderPlaybookGuide(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
