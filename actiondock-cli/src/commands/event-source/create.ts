import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import { mergeEventSourceDefinition, parseDefinitionInput, resolveEnabledFlag } from "../../lib/event.js";
import { renderEventSourceDetail } from "../../lib/render.js";

export default class EventSourceCreateCommand extends BaseCommand {
  static description = "Create an ActionDock event source";

  static flags = {
    ...BaseCommand.baseFlags,
    "definition-json": Flags.string({
      description: "Inline JSON object for the event source definition",
      required: true
    }),
    "definition-file": Flags.string({
      description: "Path to a JSON file containing the event source definition"
    }),
    "source-id": Flags.string({
      description: "Event source ID override"
    }),
    name: Flags.string({
      description: "Event source name override"
    }),
    key: Flags.string({
      description: "Event source key override"
    }),
    description: Flags.string({
      description: "Event source description override"
    }),
    "transport-type": Flags.string({
      description: "Transport type override"
    }),
    enabled: Flags.boolean({
      description: "Create the event source as enabled"
    }),
    disabled: Flags.boolean({
      description: "Create the event source as disabled"
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
    const { flags } = await this.parse(EventSourceCreateCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const definition = mergeEventSourceDefinition(
        parseDefinitionInput(flags["definition-json"], flags["definition-file"], {
          jsonFlag: "`--definition-json`",
          fileFlag: "`--definition-file`"
        }),
        {
          id: flags["source-id"],
          name: flags.name,
          key: flags.key,
          description: flags.description,
          enabled: resolveEnabledFlag({
            enabledFlag: flags.enabled,
            disabledFlag: flags.disabled
          }),
          transportType: flags["transport-type"]?.toUpperCase()
        }
      );
      const item = await client.createEventSource(definition);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderEventSourceDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
