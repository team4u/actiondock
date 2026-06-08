import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { renderConfigValueDetail } from "../../lib/render.js";
export default class ConfigValueRestoreRepositoryDefaultCommand extends BaseCommand {
    static description = "Restore a managed config value from repository defaults";
    static args = {
        key: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...BaseCommand.connectionFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ConfigValueRestoreRepositoryDefaultCommand);
        try {
            const item = await this.getClient(flags).configValues.restoreRepositoryDefault(args.key);
            flags.json ? this.printJson(item) : this.log(renderConfigValueDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
