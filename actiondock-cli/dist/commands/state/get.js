import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderSharedStateDetail } from "../../lib/render.js";
export default class StateGetCommand extends BaseCommand {
    static description = "Show a shared-state entry";
    static args = {
        namespace: Args.string({ required: true }),
        key: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(StateGetCommand);
        try {
            const client = this.getClient(flags);
            const item = await client.sharedState.get(args.namespace, args.key);
            if (flags.json) {
                this.printJson(item);
                return;
            }
            this.log(renderSharedStateDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
