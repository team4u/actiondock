import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderConfigValueDetail } from "../../lib/render.js";
export default class ConfigValueGetCommand extends BaseCommand {
    static description = "Show an ActionDock config value";
    static args = {
        key: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ConfigValueGetCommand);
        try {
            const item = await this.getClient(flags).configValues.get(args.key);
            flags.json ? this.printJson(item) : this.log(renderConfigValueDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
