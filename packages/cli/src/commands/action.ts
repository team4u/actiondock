import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ActionRunner,
  createStorage,
  findProjectRoot,
  listLinkedPackages,
  loadActions,
  loadProjectConfig,
  resolveActionProject,
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
    .description("List actions in current project or all linked packages")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const root = findProjectRoot();
        if (root) {
          const config = loadProjectConfig(root);
          const actions = await loadActions(root, config.actionsDir);
          const list = Array.from(actions.values()).map((a) => ({
            id: a.id,
            description: a.description || "",
          }));

          if (options.json) {
            console.log(JSON.stringify(list, null, 2));
          } else {
            console.log(`Actions in ${config.id} (${root}):\n`);
            for (const a of list) {
              console.log(`  ${a.id.padEnd(28)} ${a.description}`);
            }
          }
        } else {
          // List actions across all linked packages
          const linkedList = listLinkedPackages();
          if (linkedList.length === 0) {
            console.log("No ActionDock project in current directory, and no packages linked.");
            console.log("Run 'ac link' inside an Action package to register it.");
            return;
          }

          const aggregated: Array<{
            packageId: string;
            packageName: string;
            path: string;
            actions: Array<{ id: string; description: string }>;
          }> = [];

          for (const pkg of linkedList) {
            if (!existsSync(pkg.path)) continue;
            try {
              const config = loadProjectConfig(pkg.path);
              const actions = await loadActions(pkg.path, config.actionsDir);
              aggregated.push({
                packageId: pkg.id,
                packageName: pkg.name,
                path: pkg.path,
                actions: Array.from(actions.values()).map((a) => ({
                  id: a.id,
                  description: a.description || "",
                })),
              });
            } catch {
              // Ignore broken linked package
            }
          }

          if (options.json) {
            console.log(JSON.stringify(aggregated, null, 2));
          } else {
            console.log("Linked Action Packages:\n");
            for (const pkg of aggregated) {
              console.log(`* Package: ${pkg.packageId} (${pkg.path})`);
              for (const a of pkg.actions) {
                console.log(`    - ${a.id.padEnd(26)} ${a.description}`);
              }
            }
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
          console.error(`Error: Target action file already exists at ${targetFullFile}`);
          process.exit(1);
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
        console.log(`[OK] Created Action '${id}' at ${targetFullFile}`);
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
      try {
        const resolved = await resolveActionProject(id);
        const config = loadProjectConfig(resolved.projectRoot);
        const actions = await loadActions(resolved.projectRoot, config.actionsDir);
        const action = actions.get(resolved.actionId);
        if (!action) {
          console.error(`Error: Action '${resolved.actionId}' not found in package '${resolved.packageId}'`);
          process.exit(1);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                id: action.id,
                packageId: resolved.packageId,
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
          console.log(`Package:     ${resolved.packageId} (${resolved.projectRoot})`);
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

        const toValidate = id ? [actions.get(id)].filter(Boolean) : Array.from(actions.values());
        if (id && toValidate.length === 0) {
          console.error(`Error: Action '${id}' not found in project`);
          process.exit(1);
        }

        const results: Array<{ id: string; valid: boolean; errors: string[] }> = [];

        for (const act of toValidate as any[]) {
          const errors: string[] = [];
          if (!act.id) errors.push("Missing id property");
          if (!act.run || typeof act.run !== "function") errors.push("Missing run method");
          if (act.inputSchema) {
            const vRes = validateSchema(act.inputSchema, {});
            // Check if schema itself is valid
            if (typeof act.inputSchema !== "object") {
              errors.push("Invalid inputSchema object");
            }
          }
          if (act.outputSchema) {
            if (typeof act.outputSchema !== "object") {
              errors.push("Invalid outputSchema object");
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
              console.log(`[OK] ${r.id}: Valid`);
            } else {
              console.log(`[FAIL] ${r.id}: ${r.errors.join(", ")}`);
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
    .description("Execute an action (from current project or linked packages)")
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
  let resolvedProjectRoot: string;
  let resolvedActionId: string;
  let packageId: string;

  try {
    const resolved = await resolveActionProject(id);
    resolvedProjectRoot = resolved.projectRoot;
    resolvedActionId = resolved.actionId;
    packageId = resolved.packageId;
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
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
    const config = loadProjectConfig(resolvedProjectRoot);
    const actions = await loadActions(resolvedProjectRoot, config.actionsDir);
    const storage = createStorage(config.id, { projectRoot: resolvedProjectRoot });

    const runner = new ActionRunner({
      packageId: config.id,
      storage,
      projectConfig: config,
      configOverrides,
      actions,
    });

    const result = await runner.execute(resolvedActionId, input);
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
