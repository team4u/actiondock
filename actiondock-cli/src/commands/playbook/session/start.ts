import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { createClient, serverTokenFlags } from "../../../lib/command-helpers.js";
import { renderPlaybookSession } from "../../../lib/render.js";

export default class PlaybookSessionStartCommand extends BaseCommand {
  static description = "Start an ActionDock playbook session";

  static args = {
    "playbook-id": Args.string({ required: true, description: "Playbook ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    intent: Flags.string({ description: "Task intent used to select the playbook" }),
    "user-prompt": Flags.string({ description: "Original user prompt" }),
    agent: Flags.string({ description: "Agent name" }),
    "agent-run-id": Flags.string({ description: "External agent run ID" }),
    "parent-session-id": Flags.string({ description: "Parent playbook session ID" }),
    "handoff-from-session-id": Flags.string({ description: "Source session ID for handoff" }),
    "handoff-relation": Flags.string({ description: "Handoff relation" }),
    "repository-id": Flags.string({ description: "Repository ID included in selectedFrom payload" }),
    "candidate-playbook-id": Flags.string({
      description: "Candidate playbook ID, can be repeated",
      multiple: true
    }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookSessionStartCommand);
    try {
      const candidatePlaybookIds = flags["candidate-playbook-id"] ?? [];
      const selectedFrom: Record<string, unknown> = {};
      if (flags.intent) selectedFrom.query = flags.intent;
      if (flags["repository-id"]) selectedFrom.repositoryId = flags["repository-id"];
      if (candidatePlaybookIds.length > 0) selectedFrom.candidatePlaybookIds = candidatePlaybookIds;

      const session = await createClient(flags).startPlaybookSession(args["playbook-id"], {
        userPrompt: flags["user-prompt"],
        intent: flags.intent,
        agentName: flags.agent,
        agentRunId: flags["agent-run-id"],
        parentSessionId: flags["parent-session-id"],
        handoffFromSessionId: flags["handoff-from-session-id"],
        handoffRelation: flags["handoff-relation"],
        selectedFrom,
        candidatePlaybookIds
      });
      flags.json ? this.printJson(session) : this.log(renderPlaybookSession(session));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
