import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ActionRunner,
  createStorage,
  executeRemoteAction,
  fetchRemoteActions,
  fetchRemoteActionShow,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadActions,
  loadProjectConfig,
  resolveActionProject,
  resolveTarget,
  validateSchema,
} from "@actiondock/core";
import { Command } from "commander";
import { resolveIntent } from "../utils/filter";

export function registerActionCommands(program: Command): void {
  const actionCmd = program
    .command("action")
    .description("Manage and execute Actions");

  // action list
  actionCmd
    .command("list [patterns...]")
    .description("List actions in current project, linked packages, or remote profile")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action(async (patterns, options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;

        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          let list = await fetchRemoteActions(
            target.serverUrl!,
            target.token,
            effectiveIntent
          );

          let isFallback = false;
          if (list.length === 0 && effectiveIntent && shouldFallback) {
            list = await fetchRemoteActions(target.serverUrl!, target.token);
            isFallback = true;
          }

          if (options.json) {
            console.log(JSON.stringify(list, null, 2));
          } else {
            console.log(
              `Actions on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}:\n`
            );
            if (isFallback && effectiveIntent) {
              console.log(`(No remote actions matched intent '${effectiveIntent}', showing all actions)\n`);
            }
            for (const a of list) {
              console.log(`  ${a.id.padEnd(28)} ${a.description}`);
            }
          }
          return;
        }

        const root = findProjectRoot();
        if (root) {
          const config = loadProjectConfig(root);
          const actions = await loadActions(root, config.actionsDir);
          const rawList = Array.from(actions.values()).map((a) => ({
            id: a.id,
            description: a.description || "",
            packageId: config.id,
          }));

          const filterRes = filterWithFallbackInfo(
            rawList,
            effectiveIntent,
            [(a) => a.id, (a) => a.description, (a) => a.packageId],
            shouldFallback
          );

          if (options.json) {
            console.log(JSON.stringify(filterRes.items, null, 2));
          } else {
            console.log(`Actions in ${config.id} (${root}):\n`);
            if (filterRes.isFallback && effectiveIntent) {
              console.log(`(No actions matched intent '${effectiveIntent}', showing all actions)\n`);
            }
            for (const a of filterRes.items) {
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
              const pkgActions = Array.from(actions.values()).map((a) => ({
                id: a.id,
                description: a.description || "",
              }));

              aggregated.push({
                packageId: pkg.id,
                packageName: pkg.name,
                path: pkg.path,
                actions: pkgActions,
              });
            } catch {
              // Ignore broken linked package
            }
          }

          let filteredPackages: typeof aggregated = [];
          if (!effectiveIntent) {
            filteredPackages = aggregated;
          } else {
            for (const pkg of aggregated) {
              const pkgMatches = filterWithFallbackInfo(
                [pkg],
                effectiveIntent,
                [(p) => p.packageId, (p) => p.packageName, (p) => p.path],
                false
              ).matchedCount > 0;

              if (pkgMatches) {
                filteredPackages.push(pkg);
              } else {
                const matchedActions = filterWithFallbackInfo(
                  pkg.actions,
                  effectiveIntent,
                  [(a) => a.id, (a) => a.description],
                  false
                ).items;

                if (matchedActions.length > 0) {
                  filteredPackages.push({
                    ...pkg,
                    actions: matchedActions,
                  });
                }
              }
            }

            if (filteredPackages.length === 0 && shouldFallback) {
              filteredPackages = aggregated;
            }
          }

          if (options.json) {
            console.log(JSON.stringify(filteredPackages, null, 2));
          } else {
            console.log("Linked Action Packages:\n");
            for (const pkg of filteredPackages) {
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
    .option("-p, --profile <name>", "Execute or query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const detail = await fetchRemoteActionShow(
            target.serverUrl!,
            id,
            target.token
          );
          if (options.json) {
            console.log(JSON.stringify(detail, null, 2));
          } else {
            console.log(`Action:      ${detail.id}`);
            if (detail.packageId) console.log(`Package:     ${detail.packageId}`);
            if (detail.description) console.log(`Description: ${detail.description}`);
            if (detail.inputSchema) {
              console.log("\nInput Schema:");
              console.log(JSON.stringify(detail.inputSchema, null, 2));
            }
            if (detail.outputSchema) {
              console.log("\nOutput Schema:");
              console.log(JSON.stringify(detail.outputSchema, null, 2));
            }
          }
          return;
        }

        const resolved = await resolveActionProject(id);
        const config = loadProjectConfig(resolved.projectRoot);
        const actions = await loadActions(resolved.projectRoot, config.actionsDir);
        const action = actions.get(resolved.actionId);
        if (!action) {
          console.error(`Error: Action '${resolved.actionId}' not found in package '${resolved.packageId}'`);
          process.exit(1);
        }

        const declaredConfigs = config.config
          ? Object.entries(config.config).map(([k, v]) => ({
              key: k,
              description: v.description || "",
              default: v.default,
              secret: v.secret || false,
            }))
          : [];

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                id: action.id,
                packageId: resolved.packageId,
                description: action.description,
                inputSchema: action.inputSchema,
                outputSchema: action.outputSchema,
                config: declaredConfigs,
              },
              null,
              2
            )
          );
        } else {
          console.log(`Action:      ${action.id}`);
          console.log(`Package:     ${resolved.packageId} (${resolved.projectRoot})`);
          if (action.description) console.log(`Description: ${action.description}`);
          if (declaredConfigs.length > 0) {
            console.log("\nDeclared Configs:");
            for (const item of declaredConfigs) {
              const isSec = item.secret ? " [secret]" : "";
              const def = item.default !== undefined ? ` (default: ${JSON.stringify(item.default)})` : "";
              console.log(`  - ${item.key.padEnd(24)} ${item.description}${def}${isSec}`);
            }
          }
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
    .description("Execute an action (from current project, linked packages, or remote profile)")
    .option("-i, --input <json>", "Input as JSON string")
    .option("-f, --input-file <path>", "Input from JSON file")
    .option("-c, --config <key=value...>", "Temporary config override (repeatable or comma-separated)")
    .option("-p, --profile <name>", "Execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
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
    .option("-p, --profile <name>", "Execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .action(async (id, options) => {
      await executeAction(id, options);
    });
}

async function executeAction(id: string, options: any): Promise<void> {
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

  // Check target (remote profile vs local)
  let target;
  try {
    target = resolveTarget({
      profile: options.profile,
      server: options.server,
      token: options.token,
    });
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (target.type === "remote") {
    try {
      const result = await executeRemoteAction(
        target.serverUrl!,
        id,
        input,
        configOverrides,
        target.token
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exit(1);
      }
      return;
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  }

  // Local execution
  let resolvedProjectRoot: string;
  let resolvedActionId: string;

  try {
    const resolved = await resolveActionProject(id);
    resolvedProjectRoot = resolved.projectRoot;
    resolvedActionId = resolved.actionId;
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
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
