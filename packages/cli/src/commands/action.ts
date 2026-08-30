import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ActionRunner,
  createStorage,
  findProjectRoot,
  loadActions,
  loadProjectConfig,
  validateSchema,
} from "@actiondock/core";
import { Command } from "commander";

export function registerActionCommands(program: Command): void {
  const actionCmd = program
    .command("action")
    .description("Manage and execute Actions");

  // action list
  actionCmd
    .command("list")
    .description("List all actions in current project")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);
        const list = Array.from(actions.values()).map((a) => ({
          id: a.id,
          description: a.description || "",
        }));

        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          console.log(`Actions in ${config.id}:\n`);
          for (const a of list) {
            console.log(`  ${a.id.padEnd(28)} ${a.description}`);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // action create / new
  actionCmd
    .command("create <id>")
    .alias("new")
    .description("Scaffold a new Action definition file")
    .option("-d, --desc <description>", "Action description")
    .option("-f, --file <filePath>", "Target file path relative to actions dir")
    .action(async (id, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project (actiondock.json not found)");
        process.exit(1);
      }
      try {
        const config = loadProjectConfig(root);
        const actionsDir = resolve(root, config.actionsDir || "actions");
        if (!existsSync(actionsDir)) {
          mkdirSync(actionsDir, { recursive: true });
        }

        const cleanName = id.includes(".") ? id.split(".").pop()! : id;
        const targetRelFile = options.file || `${cleanName}.ts`;
        const targetFullFile = resolve(actionsDir, targetRelFile);

        if (existsSync(targetFullFile)) {
          console.error(`Error: File '${targetFullFile}' already exists`);
          process.exit(1);
        }

        mkdirSync(dirname(targetFullFile), { recursive: true });

        const desc = options.desc || `Execute ${id} action`;
        const template = `import { defineAction } from "@actiondock/sdk";

export interface Input {
  // Define input parameters
  exampleParam?: string;
}

export interface Output {
  // Define output fields
  success: boolean;
  result?: unknown;
}

export default defineAction<Input, Output>({
  id: ${JSON.stringify(id)},
  description: ${JSON.stringify(desc)},

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
        console.log(`✓ Created Action '${id}' at ${targetFullFile}`);
        console.log(`\nTo run this action:`);
        console.log(`  ac action run ${id} --input '{"exampleParam": "hello"}'`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // action show / describe
  actionCmd
    .command("show <id>")
    .alias("describe")
    .description("Show action definition, schema, and description")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);
        const action = actions.get(id);
        if (!action) {
          console.error(`Error: Action '${id}' not found`);
          process.exit(1);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                id: action.id,
                description: action.description,
                inputSchema: action.inputSchema,
                outputSchema: action.outputSchema,
              },
              null,
              2
            )
          );
        } else {
          console.log(`Action:      ${action.id}`);
          if (action.description) console.log(`Description: ${action.description}`);
          if (action.inputSchema) {
            console.log("\nInput Schema:");
            console.log(JSON.stringify(action.inputSchema, null, 2));
          }
          if (action.outputSchema) {
            console.log("\nOutput Schema:");
            console.log(JSON.stringify(action.outputSchema, null, 2));
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // action validate
  actionCmd
    .command("validate [id]")
    .description("Validate action schemas and definitions")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);
        const targets = id ? [actions.get(id)].filter(Boolean) : Array.from(actions.values());

        if (id && targets.length === 0) {
          console.error(`Error: Action '${id}' not found`);
          process.exit(1);
        }

        const results: Array<{ id: string; valid: boolean; errors: string[] }> = [];
        for (const act of targets) {
          if (!act) continue;
          const errors: string[] = [];
          if (!act.id) errors.push("Missing id");
          if (typeof act.run !== "function") errors.push("Missing run function");
          if (act.inputSchema) {
            const v = validateSchema(act.inputSchema, {});
            if (!v.valid && v.errors?.some((e) => e.startsWith("Schema compilation error"))) {
              errors.push(...v.errors);
            }
          }
          if (act.outputSchema) {
            const v = validateSchema(act.outputSchema, {});
            if (!v.valid && v.errors?.some((e) => e.startsWith("Schema compilation error"))) {
              errors.push(...v.errors);
            }
          }
          results.push({
            id: act.id,
            valid: errors.length === 0,
            errors,
          });
        }

        const allValid = results.every((r) => r.valid);
        if (options.json) {
          console.log(JSON.stringify({ valid: allValid, results }, null, 2));
        } else {
          for (const r of results) {
            if (r.valid) {
              console.log(`✓ ${r.id}: Valid`);
            } else {
              console.log(`✗ ${r.id}: ${r.errors.join(", ")}`);
            }
          }
        }
        if (!allValid) process.exit(1);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // action run
  actionCmd
    .command("run <id>")
    .description("Execute an action")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override (repeatable or comma-separated)")
    .action(async (id, options) => {
      await executeAction(id, options);
    });

  // Root level alias: ac run <id>
  program
    .command("run <id>")
    .description("Alias for 'ac action run <id>'")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override")
    .action(async (id, options) => {
      await executeAction(id, options);
    });
}

async function executeAction(id: string, options: any): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error("Error: Not in an ActionDock project");
    process.exit(1);
  }

  let input: unknown = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input);
    } catch (err: any) {
      console.error(`Error parsing --input JSON: ${err.message}`);
      process.exit(1);
    }
  } else if (options.inputFile) {
    try {
      input = JSON.parse(readFileSync(options.inputFile, "utf-8"));
    } catch (err: any) {
      console.error(`Error reading --input-file: ${err.message}`);
      process.exit(1);
    }
  }

  const configOverrides: Record<string, unknown> = {};
  if (options.config) {
    const list = Array.isArray(options.config) ? options.config : [options.config];
    for (const item of list) {
      const [k, ...v] = item.split("=");
      if (k) configOverrides[k] = v.join("=");
    }
  }

  try {
    const config = loadProjectConfig(root);
    const actions = await loadActions(root, config.actionsDir);
    const storage = createStorage(config.id, { projectRoot: root });

    const runner = new ActionRunner({
      packageId: config.id,
      storage,
      projectConfig: config,
      configOverrides,
      actions,
    });

    const result = await runner.execute(id, input);
    console.log(JSON.stringify(result, null, 2));
    storage.close();

    if (!result.ok) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
