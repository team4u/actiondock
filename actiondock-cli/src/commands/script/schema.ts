import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { buildScriptRunExampleCliCommand } from "../../lib/cli-examples.js";
import { renderSchemaDetail } from "../../lib/render.js";
import { extractSchemaFields, splitSchemaFields } from "../../lib/schema.js";

export default class ScriptSchemaCommand extends BaseCommand {
  static description = "Show a script input schema summary";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    draft: Flags.boolean({
      description: "Inspect the draft script instead of the published snapshot"
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptSchemaCommand);

    try {
      const client = this.getClient(flags);
      const script = await client.scripts.get(args.scriptId, flags.draft);
      const schema = flags.draft ? script.inputSchema : script.published?.inputSchema ?? script.inputSchema;
      const fields = extractSchemaFields(schema);
      const { flagFields, jsonOnlyFields } = splitSchemaFields(fields);
      const example = buildScriptRunExampleCliCommand({
        draft: flags.draft,
        fields,
        scriptId: args.scriptId
      });
      const payload = {
        script: {
          id: script.id,
          name: script.name,
          type: script.type,
          description: script.description
        },
        target: flags.draft ? "draft" : "published",
        inputSchema: schema ?? {},
        fields,
        flagFields,
        jsonOnlyFields,
        exampleInput: example.input,
        exampleCliCommand: example.command
      };

      if (flags.json) {
        this.printJson(payload);
        return;
      }

      this.log(renderSchemaDetail({
        exampleCliCommand: example.command,
        script,
        target: flags.draft ? "draft" : "published",
        fields
      }));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
