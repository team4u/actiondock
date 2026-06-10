import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockCliError } from "../../lib/error.js";
import { buildInputFromSchema, collectDynamicFlags, parseInputObject } from "../../lib/input.js";
import { extractSchemaFields } from "../../lib/schema.js";

export default class PluginInvokeCommand extends BaseCommand {
  static description = "Invoke an ActionDock plugin action";

  static args = {
    pluginId: Args.string({ required: true }),
    action: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "args-json": Flags.string({
      description: "Base JSON object for action args"
    }),
    "args-file": Flags.string({
      description: "Path to a JSON file containing the base action args object"
    }),
    "script-input-json": Flags.string({
      description: "JSON object passed as scriptInput"
    }),
    "script-input-file": Flags.string({
      description: "Path to a JSON file passed as scriptInput"
    }),
    "response-view": Flags.string({
      description: "Response detail level",
      options: ["result", "debug"],
      default: "result"
    }),
    "config-name": Flags.string({
      description: "Named plugin config to use"
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  static strict = false;
  static ["--"] = false;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginInvokeCommand);

    try {
      const client = this.getClient(flags);
      const plugin = await client.plugins.get(args.pluginId);
      const action = plugin.actions.find((item) => item.action === args.action);
      if (!action) {
        throw new ActionDockCliError(`插件 ${args.pluginId} 不存在动作 ${args.action}`, 2);
      }

      const actionFields = extractSchemaFields(action.inputSchema);
      const baseArgs = parseInputObject(flags["args-json"], flags["args-file"], {
        jsonFlag: "`--args-json`",
        fileFlag: "`--args-file`"
      });
      const dynamicFlags = collectDynamicFlags(this.argv, {
        positionals: [args.pluginId, args.action]
      });
      const { input: actionArgs } = buildInputFromSchema(baseArgs, dynamicFlags, actionFields, {
        jsonFlag: "`--args-json`",
        fileFlag: "`--args-file`"
      });
      const scriptInput = parseInputObject(flags["script-input-json"], flags["script-input-file"], {
        jsonFlag: "`--script-input-json`",
        fileFlag: "`--script-input-file`"
      });

      const response = await client.plugins.invoke(args.pluginId, args.action, {
        args: actionArgs,
        scriptInput,
        responseView: flags["response-view"].toUpperCase() as "RESULT" | "DEBUG",
        configName: flags["config-name"]
      });

      this.printJson(response);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
