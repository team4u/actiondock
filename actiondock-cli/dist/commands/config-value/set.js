import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { renderConfigValueDetail } from "../../lib/render.js";
export default class ConfigValueSetCommand extends BaseCommand {
    static description = "Create or update an ActionDock config value";
    static args = {
        key: Args.string({ required: true })
    };
    static flags = {
        ...BaseCommand.baseFlags,
        value: Flags.string({ description: "Config value" }),
        description: Flags.string({ description: "Config value description" }),
        secret: Flags.boolean({ description: "Mark the config value as secret" }),
        "preserve-value": Flags.boolean({ description: "Preserve existing value while updating metadata" }),
        create: Flags.boolean({ description: "Create instead of update" }),
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };
    async run() {
        const { args, flags } = await this.parse(ConfigValueSetCommand);
        try {
            const payload = {
                key: args.key,
                value: flags.value,
                description: flags.description,
                secret: flags.secret,
                preserveValue: flags["preserve-value"]
            };
            const client = createClient(flags);
            const item = flags.create ? await client.createConfigValue(payload) : await client.updateConfigValue(args.key, payload);
            flags.json ? this.printJson(item) : this.log(renderConfigValueDetail(item));
        }
        catch (error) {
            this.handleError(error, flags.json);
        }
    }
}
