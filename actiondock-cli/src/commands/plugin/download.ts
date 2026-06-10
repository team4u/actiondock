import fs from "node:fs";

import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { resolveOutputPath } from "../../lib/command-helpers.js";

export default class PluginDownloadCommand extends BaseCommand {
  static description = "Download an installed ActionDock plugin JAR";

  static args = {
    pluginId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    output: Flags.string({ char: "o", description: "Output file or directory" }),
    force: Flags.boolean({ description: "Overwrite existing output file" }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginDownloadCommand);
    try {
      const download = await this.getClient(flags).plugins.download(args.pluginId);
      const outputPath = resolveOutputPath(flags.output, download.filename, flags.force);
      fs.writeFileSync(outputPath, download.content);
      flags.json ? this.printJson({ pluginId: args.pluginId, output: outputPath, bytes: download.content.byteLength }) : this.log(outputPath);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
