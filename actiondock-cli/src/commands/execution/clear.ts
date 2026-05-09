import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";

export default class ExecutionClearCommand extends BaseCommand {
  static description = "Clear ActionDock execution records";

  static flags = {
    ...BaseCommand.baseFlags,
    "script-id": Flags.string({
      description: "Only clear records for the given script ID"
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
    const { flags } = await this.parse(ExecutionClearCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      await client.clearExecutions(flags["script-id"]);

      if (flags.json) {
        this.printJson({ cleared: true, scriptId: flags["script-id"] ?? null });
        return;
      }

      this.log(flags["script-id"] ? `已清空脚本 ${flags["script-id"]} 的执行记录。` : "已清空全部执行记录。");
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
