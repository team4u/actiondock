import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
export default class ExecutionDeleteCommand extends BaseCommand {
    static description = "Delete an ActionDock execution record";
    static args = {
        executionId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        profile: Flags.string({
            description: "Use a configured server profile"
        }),
        server: Flags.string({
            description: "Override ActionDock server URL"
        }),
        token: Flags.string({
            description: "Override ActionDock bearer token"
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ExecutionDeleteCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            await client.deleteExecution(args.executionId);
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
