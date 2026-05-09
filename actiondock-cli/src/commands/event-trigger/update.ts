import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockClient } from "../../lib/client.js";
import { resolveServerUrl, resolveToken } from "../../lib/config.js";
import {
  applyProcessorFieldOverrides,
  mergeDefinitionPatch,
  mergeEventTriggerDefinition,
  parseOptionalObject,
  resolveEnabledFlag
} from "../../lib/event.js";
import { renderEventTriggerDetail } from "../../lib/render.js";
import type { EventTrigger } from "../../lib/types.js";

export default class EventTriggerUpdateCommand extends BaseCommand {
  static description = "Update an ActionDock event trigger";

  static args = {
    triggerId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "definition-json": Flags.string({
      description: "Inline JSON object merged into the saved event trigger definition"
    }),
    "definition-file": Flags.string({
      description: "Path to a JSON file merged into the saved event trigger definition"
    }),
    name: Flags.string({
      description: "Event trigger name override"
    }),
    description: Flags.string({
      description: "Event trigger description override"
    }),
    "source-id": Flags.string({
      description: "Event source ID override"
    }),
    "target-script-id": Flags.string({
      description: "Target script ID override"
    }),
    "submit-mode": Flags.string({
      description: "Submit mode override",
      options: ["sync", "async"]
    }),
    "response-view": Flags.string({
      description: "Execution response view override",
      options: ["result", "debug"]
    }),
    enabled: Flags.boolean({
      description: "Mark the event trigger as enabled"
    }),
    disabled: Flags.boolean({
      description: "Mark the event trigger as disabled"
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
    const { args, flags } = await this.parse(EventTriggerUpdateCommand);

    try {
      const client = new ActionDockClient({
        serverUrl: resolveServerUrl(flags),
        token: resolveToken(flags)
      });
      const existing = await client.getEventTrigger(args.triggerId);
      const patch = parseOptionalObject<EventTrigger>(flags["definition-json"], flags["definition-file"], {
        jsonFlag: "`--definition-json`",
        fileFlag: "`--definition-file`"
      }) ?? {};
      const mergedPatch = applyProcessorFieldOverrides(
        mergeDefinitionPatch(existing, patch),
        patch,
        ["filterProcessor", "idempotencyProcessor", "inputProcessor"]
      );
      const merged = mergeEventTriggerDefinition(
        mergedPatch,
        {
          id: args.triggerId,
          name: flags.name,
          description: flags.description,
          sourceId: flags["source-id"],
          targetScriptId: flags["target-script-id"],
          submitMode: flags["submit-mode"]?.toUpperCase(),
          responseView: flags["response-view"]?.toUpperCase(),
          enabled: resolveEnabledFlag({
            enabledFlag: flags.enabled,
            disabledFlag: flags.disabled,
            fallback: existing.enabled
          })
        }
      );
      const item = await client.updateEventTrigger(args.triggerId, merged);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderEventTriggerDetail(item));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
