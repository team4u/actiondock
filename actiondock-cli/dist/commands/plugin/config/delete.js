import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
export default class PluginConfigDeleteCommand extends BaseCommand {
    static description = "Delete a named config for an installed plugin";
    static args = {
        pluginId: Args.string({ required: true }),
        configName: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginConfigDeleteCommand);
        try {
            await createClient(flags).plugins.deleteConfig(args.pluginId, args.configName);
            flags.json
                ? this.printJson({ deleted: true, pluginId: args.pluginId, configName: args.configName })
                : this.log(`插件配置已删除: ${args.pluginId}/${args.configName}`);
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
