import { Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, intentFlag, listWithIntentFallback } from "../../lib/command-helpers.js";
import type { RepositoryKnowledgeDescriptor } from "../../lib/types.js";

export default class RepositoryKnowledgeListCommand extends BaseCommand {
  static description = "List knowledge entries in repositories";

  static flags = {
    ...BaseCommand.baseFlags,
    "repository-id": Flags.string({ description: "Filter by repository ID" }),
    intent: intentFlag,
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepositoryKnowledgeListCommand);
    try {
      const client = this.getClient(flags);
      const items = await listWithIntentFallback(flags.intent, (intent) => client.repositories.listKnowledge(flags["repository-id"], intent));
      flags.json ? this.printJson(items) : this.log(renderKnowledgeList(items));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}

function renderKnowledgeList(items: RepositoryKnowledgeDescriptor[]): string {
  if (items.length === 0) return "No knowledge entries found.";
  const rows = items.map(k =>
    `  ${k.knowledgeId.padEnd(25)} ${k.displayName.padEnd(20)} ${k.source.type.padEnd(10)} ${k.installed ? "INSTALLED" : "available"} ${k.trusted ? "TRUSTED" : ""}`
  );
  return ["ID                         Name                 Source     Status", ...rows].join("\n");
}
