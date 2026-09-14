import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  assertPathWithinRoot,
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
 * 解析用户通过命令行传入的字段定义字符串（如 name:string, count?:number）。
 */
export function parseSchemaFields(rawFields?: string[] | string): {
  properties: Record<string, any>;
  required: string[];
} | null {
  if (!rawFields) return null;
  const items = Array.isArray(rawFields) ? rawFields : [rawFields];
  const tokens = items
    .flatMap((item) => item.split(/[, ]+/))
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    let rawKey = colonIdx > -1 ? token.slice(0, colonIdx).trim() : token.trim();
    const rawType = colonIdx > -1 ? token.slice(colonIdx + 1).trim().toLowerCase() : "string";

    let isOptional = false;
    if (rawKey.endsWith("?")) {
      isOptional = true;
      rawKey = rawKey.slice(0, -1).trim();
    }

    if (!rawKey) continue;

    let schemaType = "string";
    const extraProps: Record<string, any> = {};

    if (rawType === "number" || rawType === "int" || rawType === "integer") {
      schemaType = "number";
    } else if (rawType === "boolean" || rawType === "bool") {
      schemaType = "boolean";
    } else if (rawType === "array" || rawType === "list") {
      schemaType = "array";
      extraProps.items = { type: "string" };
    } else if (rawType === "object" || rawType === "json") {
      schemaType = "object";
    } else {
      schemaType = "string";
    }

    properties[rawKey] = {
      type: schemaType,
      ...extraProps,
    };

    if (!isOptional) {
      required.push(rawKey);
    }
  }

  return { properties, required };
}

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
    .option("-i, --input <fields...>", "Input schema fields (e.g. name:string, count?:number)")
    .option("-o, --output <fields...>", "Output schema fields (e.g. message:string, success:boolean)")
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

    const targetDir = dirname(targetFullFile);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const generatedTypesTarget = resolve(root, ".actiondock", "generated", "actions");
    let typesImportPath = relative(targetDir, generatedTypesTarget).replace(/\\/g, "/");
    if (!typesImportPath.startsWith("./") && !typesImportPath.startsWith("../")) {
      typesImportPath = `./${typesImportPath}`;
    }

    const parsedInput = parseSchemaFields(options.input);
    const parsedOutput = parseSchemaFields(options.output);
    const isGreet = id === "greet" || id.endsWith(".greet");

    let inputSchema: any;
    if (parsedInput) {
      inputSchema = {
        type: "object",
        properties: parsedInput.properties,
        required: parsedInput.required,
      };
    } else if (isGreet) {
      inputSchema = {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of user to greet",
          },
        },
        required: ["name"],
      };
    } else {
      inputSchema = {
        type: "object",
        properties: {
          exampleParam: {
            type: "string",
            description: "Example parameter description",
          },
        },
        required: [],
      };
    }

    let outputSchema: any;
    if (parsedOutput) {
      outputSchema = {
        type: "object",
        properties: parsedOutput.properties,
        required: parsedOutput.required,
      };
    } else if (isGreet) {
      outputSchema = {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Greeting message",
          },
        },
        required: ["message"],
      };
    } else {
      outputSchema = {
        type: "object",
        properties: {
          success: { type: "boolean" },
          result: {},
        },
        required: ["success"],
      };
    }

    let returnBody: string;
    if (outputSchema.properties && outputSchema.properties.message) {
      const nameExpr = inputSchema.properties && inputSchema.properties.name ? "input.name" : '"ActionDock"';
      returnBody = `  return {
    message: \`Hello, \${${nameExpr}}!\`,
  };`;
    } else if (outputSchema.properties && outputSchema.properties.success) {
      returnBody = `  return {
    success: true,
    result: input.exampleParam || "done",
  };`;
    } else {
      const returnLines = Object.entries(outputSchema.properties || {}).map(
        ([k, prop]: [string, any]) => {
          if (prop.type === "number") return `    ${k}: 0,`;
          if (prop.type === "boolean") return `    ${k}: true,`;
          if (prop.type === "array") return `    ${k}: [],`;
          if (prop.type === "object") return `    ${k}: {},`;
          return `    ${k}: "done",`;
        }
      );
      returnBody = `  return {\n${returnLines.join("\n")}\n  };`;
    }

    const desc = options.desc || (isGreet ? "用户问候动作" : `Action ${id}`);
    const template = `import { defineAction } from "@actiondock/sdk";
import type { ActionInput, ActionOutput } from "${typesImportPath}";

export type Input = ActionInput<"${id}">;
export type Output = ActionOutput<"${id}">;

export default defineAction<Input, Output>(async (input, ctx) => {
  ctx.log.info("Running ${id}", input);

${returnBody}
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
      inputSchema,
      outputSchema,
      uses: [],
      tags: [],
    };
    saveManifest(root, manifest);

    // 始终自动生成或更新类型声明文件，确保单一事实源即时生效
    writeActionTypes(root, manifest);

    let sampleInputStr: string;
    if (inputSchema.properties && inputSchema.properties.name) {
      sampleInputStr = '{"name": "ActionDock"}';
    } else if (parsedInput && Object.keys(parsedInput.properties).length > 0) {
      const sampleObj: Record<string, any> = {};
      for (const [k, p] of Object.entries(parsedInput.properties) as [string, any][]) {
        if (p.type === "number") sampleObj[k] = 42;
        else if (p.type === "boolean") sampleObj[k] = true;
        else if (p.type === "array") sampleObj[k] = ["item"];
        else if (p.type === "object") sampleObj[k] = {};
        else sampleObj[k] = "sample";
      }
      sampleInputStr = JSON.stringify(sampleObj);
    } else {
      sampleInputStr = '{"exampleParam": "hello"}';
    }

    writeStdout(`[OK] Created Action '${id}' at ${targetFullFile}`, context);
    writeStdout(`\nTo run this action:`, context);
    writeStdout(`  ad run ${id} --input '${sampleInputStr}'`, context);
  } catch (err: any) {
    if (err instanceof ExecutionError) throw err;
    throw new ExecutionError(err.message);
  }
}
