import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { renderCapabilityDetail } from "../../lib/render.js";

export default class CapabilityDiscardDraftCommand extends BaseCommand {
  static description = "Discard draft changes and restore the published binding";

  static args = {
    capabilityId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    server: Flags.string({
      description: "Override ActionDock server URL"
    }),
    token: Flags.string({
      description: "Override ActionDock bearer token"
    }),
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CapabilityDiscardDraftCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const item = await client.discardCapabilityDraft(args.capabilityId);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderCapabilityDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
