import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
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
    profile: Flags.string({
      description: "Use a configured server profile"
    }),
    server: Flags.string({
      description: "Override ActionDock server URL"
    }),
    token: Flags.string({
      description: "Override ActionDock bearer token"
    }),
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptSchemaCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const script = await client.getScript(args.scriptId, flags.draft);
      const schema = flags.draft ? script.inputSchema : script.published?.inputSchema ?? script.inputSchema;
      const fields = extractSchemaFields(schema);
      const { flagFields, jsonOnlyFields } = splitSchemaFields(fields);
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
        jsonOnlyFields
      };

      if (flags.json) {
        this.printJson(payload);
        return;
      }

      this.log(renderSchemaDetail({
        script,
        target: flags.draft ? "draft" : "published",
        fields
      }));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
