import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderExecution } from "../../lib/render.js";
export default class ExecutionGetCommand extends BaseCommand {
    static description = "Show an ActionDock execution record";
    static args = {
        executionId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ExecutionGetCommand);
        try {
            const client = this.getClient(flags);
            const execution = await client.executions.get(args.executionId);
            if (flags.json) {
                this.printJson(execution);
                return;
            }
            this.log(renderExecution(execution));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
