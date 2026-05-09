import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
export default class EventSourceRepositoryInstallCommand extends BaseCommand {
    static description = "Install a repository event source";
    static args = {
        repositoryId: Args.string({ required: true }),
        eventSourceId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        installScriptDependencies: Flags.boolean({
            description: "Install or update referenced script dependencies",
            default: true
        }),
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
        const { args, flags } = await this.parse(EventSourceRepositoryInstallCommand);
        try {
            const client = new ActionDockClient({
                serverUrl: resolveServerUrl(flags),
                token: resolveToken(flags)
            });
            const result = await client.installRepositoryEventSource(args.repositoryId, args.eventSourceId, {
                installSchedules: false,
                installScriptDependencies: flags.installScriptDependencies
            });
            if (flags.json) {
                this.printJson(result);
                return;
            }
            this.log(`事件源已安装: ${result.sourceId}@${result.version}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
