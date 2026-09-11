import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  assertPathWithinRoot,
  checkGeneratedTypes,
  findProjectRoot,
  getPackageSlug,
  loadManifest,
  loadProjectConfig,
  saveManifest,
  writeActionTypes,
} from "@actiondock/core";
import type { Command } from "commander";
import { ExecutionError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";

/**
 * 注册 action 命令组（action create, action new）。
 *
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerActionCommands(program: Command, context?: CliContext): void {
  const actionCmd = program
    .command("action")
    .description("Manage Action definitions (create, scaffold)");

  actionCmd
    .command("create <id>")
    .alias("new")
    .description("Scaffold a new Action definition file")
    .option("-d, --desc <description>", "Action description")
    .option("-f, --file <filePath>", "Target file path relative to actions dir")
    .action(async (id, options) => {
      await handleActionCreate(id, options, context);
    });
}

export async function handleActionCreate(
  id: string,
  options: any,
  context?: CliContext
): Promise<void> {
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

    if (options.file && isAbsolute(options.file)) {
      throw new ExecutionError(`--file option must be a relative path, received: ${options.file}`);
    }

    const cleanName = getPackageSlug(id);
    const targetRelFile = options.file || `${cleanName}.ts`;
    const targetFullFile = resolve(actionsDir, targetRelFile);
    assertPathWithinRoot(actionsDir, targetFullFile, "action file");

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

export default defineAction<Input, Output>(async (input, ctx) => {
  ctx.log.info("Running ${id}", input);

  // Access config: ctx.config.get("MY_CONFIG")
  // Access state:  await ctx.state.get("my_key") / await ctx.state.set("my_key", val)
  // Call action:   await ctx.actions.invoke(otherAction, input)

  return {
    success: true,
    result: input.exampleParam || "done",
  };
});
`;

    writeFileSync(targetFullFile, template, "utf-8");

    const manifest = loadManifest(root) || {
      $schema: "https://actiondock.dev/schema/v2/actiondock.json",
      id: config.id,
      name: config.name,
      version: config.version,
      actions: {},
    };
    manifest.actions = manifest.actions || {};
    manifest.actions[id] = {
      entry: join(config.actionsDir || "actions", targetRelFile).replace(/\\/g, "/"),
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

    // 若当前项目已存在类型生成文件，则同步自动刷新类型声明
    const typeCheck = checkGeneratedTypes(root, manifest);
    if (typeCheck.exists) {
      writeActionTypes(root, manifest);
    }

    writeStdout(`[OK] Created Action '${id}' at ${targetFullFile}`, context);
    writeStdout(`\nTo run this action:`, context);
    writeStdout(`  ad run ${id} --input '{"exampleParam": "hello"}'`, context);
  } catch (err: any) {
    if (err instanceof ExecutionError) throw err;
    throw new ExecutionError(err.message);
  }
}
