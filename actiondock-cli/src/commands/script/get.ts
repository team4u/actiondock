import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderScriptDetail } from "../../lib/render.js";

export default class ScriptGetCommand extends BaseCommand {
  static description = "Show a published or draft ActionDock script definition";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    draft: Flags.boolean({
      description: "Read the draft script instead of the published snapshot"
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
    const { args, flags } = await this.parse(ScriptGetCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const script = await client.getScript(args.scriptId, flags.draft);

      if (flags.json) {
        this.printJson(script);
        return;
      }

      this.log(renderScriptDetail(script, flags.draft ? "draft" : "published"));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
