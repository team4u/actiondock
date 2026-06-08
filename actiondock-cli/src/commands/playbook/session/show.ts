import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../../lib/command.js";
import { renderPlaybookSessionDetail } from "../../../lib/render.js";

export default class PlaybookSessionShowCommand extends BaseCommand {
  static description = "Show an ActionDock playbook session";

  static args = {
    "session-id": Args.string({ required: true, description: "Playbook session ID" })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    timeline: Flags.boolean({ description: "Render trace events as a timeline" }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PlaybookSessionShowCommand);
    try {
      const detail = await this.getClient(flags).playbooks.getSession(args["session-id"]);
      flags.json ? this.printJson(detail) : this.log(renderPlaybookSessionDetail(detail, flags.timeline));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
