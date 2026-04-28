import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";

export default class ToolGetCommand extends BaseCommand {
  static description = "Show a published or draft ActionDock tool definition";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    draft: Flags.boolean({
      description: "Read the draft script instead of the published snapshot"
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
    const { args, flags } = await this.parse(ToolGetCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const script = await client.getScript(args.scriptId, flags.draft);

      if (flags.json) {
        this.printJson(script);
        return;
      }

      this.log([
        `Script: ${script.id}${script.name ? ` (${script.name})` : ""}`,
        `Target: ${flags.draft ? "draft" : "published"}`,
        `Type: ${script.type ?? "-"}`,
        `Status: ${script.status ?? "-"}`,
        `Version: ${script.version ?? "-"}`,
        `Published: ${script.publishedSnapshot ? "yes" : "no"}`
      ].join("\n"));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
