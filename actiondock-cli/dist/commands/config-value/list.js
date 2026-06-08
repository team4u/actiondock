import { Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import { renderConfigValueList } from "../../lib/render.js";
export default class ConfigValueListCommand extends BaseCommand {
    static description = "List ActionDock config values";
    static flags = {
        ...BaseCommand.baseFlags,
        intent: intentFlag,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { flags } = await this.parse(ConfigValueListCommand);
        try {
            const client = this.getClient(flags);
            const items = await listWithIntentFallback(flags.intent, (intent) => client.configValues.list(intent));
            flags.json ? this.printJson(items) : this.log(renderConfigValueList(items));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
