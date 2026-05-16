import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { createClient, serverTokenFlags } from "../../lib/command-helpers.js";
import { parseJsonValueInput } from "../../lib/input.js";
import { renderRepositoryWebhookDetail } from "../../lib/render.js";
import type {
  RepositoryPublishConfigItem,
  RepositoryWebhookPublishRequest,
  ScriptDependency
} from "../../lib/types.js";

function parseScriptDependencies(value: unknown): ScriptDependency[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return {
      scriptId: String(record.scriptId ?? ""),
      repositoryId: String(record.repositoryId ?? ""),
      repositoryScriptId: String(record.repositoryScriptId ?? ""),
      versionRange: typeof record.versionRange === "string" ? record.versionRange : undefined
    };
  }).filter((item) => item.scriptId && item.repositoryId && item.repositoryScriptId);
}

function parseConfigItems(value: unknown): RepositoryPublishConfigItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return {
      key: String(record.key ?? ""),
      publishMode: (String(record.publishMode ?? "PLACEHOLDER").toUpperCase() === "INLINE" ? "INLINE" : "PLACEHOLDER")
    } as RepositoryPublishConfigItem;
  }).filter((item) => item.key);
}

export default class WebhookPublishCommand extends BaseCommand {
  static description = "Publish an ActionDock Webhook to a repository";

  static args = {
    webhookId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    repository: Flags.string({
      description: "Target repository ID",
      required: true
    }),
    "repository-webhook-id": Flags.string({
      description: "Repository webhook ID",
      required: true
    }),
    "display-name": Flags.string({
      description: "Repository display name",
      required: true
    }),
    version: Flags.string({
      description: "Repository version",
      required: true
    }),
    owner: Flags.string({
      description: "Repository owner"
    }),
    "release-notes": Flags.string({
      description: "Release notes"
    }),
    tag: Flags.string({
      description: "Repeatable tag",
      multiple: true
    }),
    "publish-script-dependencies": Flags.boolean({
      description: "Recursively publish referenced script dependencies",
      default: true
    }),
    "script-dependencies-json": Flags.string({
      description: "Inline JSON array of script dependency mappings"
    }),
    "script-dependencies-file": Flags.string({
      description: "Path to a JSON file containing script dependency mappings"
    }),
    "config-items-json": Flags.string({
      description: "Inline JSON array of repository config publish items"
    }),
    "config-items-file": Flags.string({
      description: "Path to a JSON file containing repository config publish items"
    }),
    force: Flags.boolean({
      description: "Force publish even when upstream has changed",
      default: false
    }),
    ...serverTokenFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WebhookPublishCommand);

    try {
      const payload: RepositoryWebhookPublishRequest = {
        sourceId: args.webhookId,
        webhookId: flags["repository-webhook-id"],
        displayName: flags["display-name"],
        version: flags.version,
        owner: flags.owner,
        releaseNotes: flags["release-notes"],
        tags: flags.tag?.length ? flags.tag : undefined,
        publishScriptDependencies: flags["publish-script-dependencies"],
        scriptDependencies: parseScriptDependencies(
          parseJsonValueInput(flags["script-dependencies-json"], flags["script-dependencies-file"], {
            jsonFlag: "`--script-dependencies-json`",
            fileFlag: "`--script-dependencies-file`"
          })
        ),
        configItems: parseConfigItems(
          parseJsonValueInput(flags["config-items-json"], flags["config-items-file"], {
            jsonFlag: "`--config-items-json`",
            fileFlag: "`--config-items-file`"
          })
        ),
        force: flags.force
      };
      const item = await createClient(flags).publishRepositoryWebhook(flags.repository, payload);

      if (flags.json) {
        this.printJson(item);
        return;
      }

      this.log(renderRepositoryWebhookDetail({
        descriptor: item,
        webhook: {
          schemaVersion: 1,
          webhookId: item.webhookId,
          displayName: item.displayName,
          version: item.version,
          description: item.description,
          releaseNotes: item.releaseNotes,
          owner: item.owner,
          tags: item.tags,
          digest: item.digest,
          scriptDependencies: item.scriptDependencies
        },
        configTemplate: []
      }));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
