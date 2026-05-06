import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { ActionDockCliError } from "../../lib/error.js";
import { parseJsonValueInput } from "../../lib/input.js";
import { renderExecution } from "../../lib/render.js";

export default class CapabilityRunCommand extends BaseCommand {
  static description = "Execute an ActionDock capability";

  static args = {
    capabilityId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    draft: Flags.boolean({
      description: "Execute the draft binding instead of the published binding"
    }),
    mode: Flags.string({
      description: "Submit mode",
      options: ["sync", "async"],
      default: "sync"
    }),
    "response-view": Flags.string({
      description: "Response detail level",
      options: ["result", "debug"],
      default: "result"
    }),
    "input-json": Flags.string({
      description: "Inline JSON input object"
    }),
    "input-file": Flags.string({
      description: "Path to a JSON file containing the input object"
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
    const { args, flags } = await this.parse(CapabilityRunCommand);

    try {
      const parsed = parseJsonValueInput(flags["input-json"], flags["input-file"], {
        jsonFlag: "`--input-json`",
        fileFlag: "`--input-file`"
      });
      if (parsed !== undefined && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
        throw new ActionDockCliError("`--input-json` / `--input-file` 顶层必须是 JSON 对象。", 2);
      }

      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags.server),
        token: resolveToken(flags.token)
      });
      const response = await client.executeCapability({
        scriptId: args.capabilityId,
        input: (parsed as Record<string, unknown> | undefined) ?? {},
        mode: flags.mode.toUpperCase() as "SYNC" | "ASYNC",
        responseView: flags["response-view"].toUpperCase() as "RESULT" | "DEBUG"
      }, flags.draft);

      if (flags.json) {
        this.printJson(response);
        return;
      }

      this.log(renderExecution(response));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
