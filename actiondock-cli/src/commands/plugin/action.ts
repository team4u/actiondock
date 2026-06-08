import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { buildPluginInvokeExampleCliCommand } from "../../lib/cli-examples.js";
import { ActionDockCliError } from "../../lib/error.js";
import { renderPluginActionDetail } from "../../lib/render.js";
import { extractSchemaFields } from "../../lib/schema.js";

export default class PluginActionCommand extends BaseCommand {
  static description = "Show the full schema for a single plugin action";

  static args = {
    pluginId: Args.string({ required: true, description: "Plugin ID" }),
    action: Args.string({ required: true, description: "Action name" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginActionCommand);

    try {
      const client = this.getClient(flags);
      const plugin = await client.plugins.get(args.pluginId);
      const action = plugin.actions.find(a => a.action === args.action);
      if (!action) {
        const available = plugin.actions.map(a => a.action).join(", ");
        throw new ActionDockCliError(
          `插件 ${args.pluginId} 不存在动作 ${args.action}。可用: ${available}`,
          2
        );
      }
      const fields = extractSchemaFields(action.inputSchema);
      const example = buildPluginInvokeExampleCliCommand({
        action: args.action,
        args: action.exampleArgs,
        fields,
        pluginId: args.pluginId
      });

      if (flags.json) {
        this.printJson({
          ...action,
          exampleArgs: example.args,
          exampleCliCommand: example.command
        });
        return;
      }

      this.log(renderPluginActionDetail(action, example.command));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
