import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderSharedStateList } from "../../lib/render.js";
export default class StateListCommand extends BaseCommand {
    static description = "List shared-state entries in a namespace";
    static args = {
        namespace: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(StateListCommand);
        try {
            const client = this.getClient(flags);
            const items = await client.sharedState.list(args.namespace);
            if (flags.json) {
                this.printJson(items);
                return;
            }
            this.log(renderSharedStateList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
