import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
export default class ExecutionDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock execution record";
    static args = {
        executionId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ExecutionDeleteCommand);
        try {
            const client = this.getClient(flags);
            await client.executions.delete(args.executionId);
            if (flags.json) {
                this.printJson({ deleted: true, executionId: args.executionId });
                return;
            }
            this.log(`已删除执行记录: ${args.executionId}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
