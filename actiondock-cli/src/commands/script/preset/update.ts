import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, jsonObjectFlags, parseNamedObject, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderExecutionPresetDetail } from "../../../lib/render.js";

export default class ScriptPresetUpdateCommand extends BaseCommand {
  static description = "Update a script execution preset";

  static args = {
    scriptId: Args.string({ required: true }),
    presetId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({ description: "Preset name", required: true }),
    ...jsonObjectFlags("input", "preset input"),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptPresetUpdateCommand);
    try {
      const item = await createClient(flags).updateExecutionPreset(args.scriptId, args.presetId, {
        name: flags.name,
        input: parseNamedObject(flags, "input", "preset input")
      });
      flags.json ? this.printJson(item) : this.log(renderExecutionPresetDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
