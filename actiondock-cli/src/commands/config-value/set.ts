import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
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
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigValueSetCommand);
    try {
      const payload = {
        key: args.key,
        value: flags.value,
        description: flags.description,
        secret: flags.secret,
        preserveValue: flags["preserve-value"]
      };
      const client = this.getClient(flags);
      const item = flags.create ? await client.configValues.create(payload) : await client.configValues.update(args.key, payload);
      flags.json ? this.printJson(item) : this.log(renderConfigValueDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
