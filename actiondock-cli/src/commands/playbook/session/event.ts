import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, parseNamedObject, jsonObjectFlags } from "../../../lib/command-helpers.js";

export default class PlaybookSessionEventCommand extends BaseCommand {
  static description = "Append an ActionDock playbook trace event";

  static args = {
    "session-id": Args.string({ required: true, description: "Playbook session ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    phase: Flags.string({ description: "Playbook phase", required: true }),
    type: Flags.string({ description: "Trace event type", required: true }),
    actor: Flags.string({ description: "Event actor" }),
    message: Flags.string({ description: "Event message" }),
    "ref-type": Flags.string({ description: "Referenced resource type" }),
    "ref-id": Flags.string({ description: "Referenced resource ID" }),
    decision: Flags.string({ description: "Decision label" }),
    reason: Flags.string({ description: "Decision reason" }),
    "observed-risk": Flags.string({ description: "Observed risk level" }),
    "stop-condition-hit": Flags.boolean({ description: "Whether a stop condition was hit" }),
    "stop-condition": Flags.string({ description: "Stop condition text" }),
    "external-event-id": Flags.string({ description: "External idempotency key for this event" }),
    ...jsonObjectFlags("payload", "trace payload"),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookSessionEventCommand);
    try {
      const payload = parseNamedObject(flags, "payload", "trace payload");
      const response = await this.getClient(flags).playbooks.appendSessionEvent(args["session-id"], {
        externalEventId: flags["external-event-id"],
        phase: flags.phase.toUpperCase() as never,
        type: flags.type.toUpperCase() as never,
        actor: flags.actor,
        message: flags.message,
        refType: flags["ref-type"],
        refId: flags["ref-id"],
        decision: flags.decision,
        reason: flags.reason,
        observedRisk: flags["observed-risk"]?.toUpperCase(),
        stopConditionHit: flags["stop-condition-hit"],
        stopCondition: flags["stop-condition"],
        payload
      });
      flags.json ? this.printJson(response) : this.log(`Event: ${response.eventId} sequence=${response.sequence}`);
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
