import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../../lib/command.js";
import { createClient, jsonObjectFlags, parseNamedObject, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderPluginConfig } from "../../../lib/render.js";
export default class PluginConfigSetCommand extends BaseCommand {
    static description = "Save ActionDock plugin config";
    static args = {
        pluginId: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        ...jsonObjectFlags("config", "plugin config"),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(PluginConfigSetCommand);
        try {
            const config = parseNamedObject(flags, "config", "plugin config");
            const item = await createClient(flags).savePluginConfig(args.pluginId, config);
            flags.json ? this.printJson(item) : this.log(renderPluginConfig(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
