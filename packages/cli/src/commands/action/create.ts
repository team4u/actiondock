import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findProjectRoot,
  getPackageSlug,
  loadManifest,
  loadProjectConfig,
  saveManifest,
} from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import type { Command } from "commander";

export function registerActionCreateCommand(actionCmd: Command): void {
  actionCmd
    .command("create <id>")
    .alias("new")
    .description("Scaffold a new Action definition file")
    .option("-d, --desc <description>", "Action description")
    .option("-f, --file <filePath>", "Target file path relative to actions dir")
    .action(async (id, options) => {
      const root = findProjectRoot();
      if (!root) {
        throw new ExecutionError("Not in an ActionDock project (actiondock.json not found)");
      }
      try {
        const config = loadProjectConfig(root);
        const actionsDir = resolve(root, config.actionsDir || "actions");
        if (!existsSync(actionsDir)) {
          mkdirSync(actionsDir, { recursive: true });
        }

        const cleanName = getPackageSlug(id);
        const targetRelFile = options.file || `${cleanName}.ts`;
        const targetFullFile = resolve(actionsDir, targetRelFile);

        if (existsSync(targetFullFile)) {
          throw new ExecutionError(`Target action file already exists at ${targetFullFile}`);
        }

        const desc = options.desc || `Action ${id}`;
        const template = `import { defineAction } from "@actiondock/sdk";

export interface Input {
  exampleParam?: string;
}

export interface Output {
  success: boolean;
  result?: unknown;
}

export default defineAction<Input, Output>({
  id: "${id}",
  description: "${desc}",

  inputSchema: {
    type: "object",
    properties: {
      exampleParam: {
        type: "string",
        description: "Example parameter description",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      result: {},
    },
    required: ["success"],
  },

  async run(input, ctx) {
    ctx.log.info("Running ${id}", input);

    // Access config: ctx.config.get("MY_CONFIG")
    // Access state:  await ctx.state.get("my_key") / await ctx.state.set("my_key", val)
    // Call action:   await ctx.actions.invoke(otherAction, input)

    return {
      success: true,
      result: input.exampleParam || "done",
    };
  },
});
`;

        writeFileSync(targetFullFile, template, "utf-8");

        const manifest = loadManifest(root) || { schemaVersion: 1, actions: {}, assets: [] };
        manifest.actions = manifest.actions || {};
        manifest.actions[id] = {
          entry: join(config.actionsDir || "actions", targetRelFile),
          description: desc,
          inputSchema: {
            type: "object",
            properties: {
              exampleParam: {
                type: "string",
                description: "Example parameter description",
              },
            },
            required: [],
          },
          outputSchema: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              result: {},
            },
            required: ["success"],
          },
          uses: [],
          tags: [],
        };
        saveManifest(root, manifest);

        console.log(`[OK] Created Action '${id}' at ${targetFullFile}`);
        console.log(`\nTo run this action:`);
        console.log(`  ad action run ${id} --input '{"exampleParam": "hello"}'`);
      } catch (err: any) {
        if (err instanceof ExecutionError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
