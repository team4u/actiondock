import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderExecution } from "../../lib/render.js";
export default class ExecutionGetCommand extends BaseCommand {
    static description = "Show an ActionDock execution record";
    static args = {
        executionId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        server: Flags.string({
            description: "Override ActionDock server URL"
        }),
        token: Flags.string({
            description: "Override ActionDock bearer token"
        }),
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ExecutionGetCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags.server),
                token: resolveToken(flags.token)
            });
            const execution = await client.getExecution(args.executionId);
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
