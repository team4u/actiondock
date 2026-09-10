import type { Command } from "commander";
import { findProjectRoot, writeActionTypes } from "@actiondock/core";
import { ArgumentError, ExecutionError } from "../errors";
import { renderResult } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions } from "../utils";

/**
 * 注册顶层 generate 代码与类型生成命令。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerGenerateCommands(program: Command, context?: CliContext): void {
  const generateCmd = program
    .command("generate")
    .description("Generate project artifacts such as TypeScript declarations");

  generateCmd
    .command("types")
    .description("Generate .actiondock/generated/actions.d.ts from actiondock.json schema")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const root = findProjectRoot();
      if (!root) {
        throw new ArgumentError("Not in an ActionDock project (actiondock.json not found)");
      }

      try {
        const { filePath, digest } = writeActionTypes(root);
        const result = {
          success: true,
          filePath,
          digest,
        };

        renderResult(result, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => `[OK] Generated action types at ${filePath}\nManifest digest: ${digest}`,
          context,
        });
      } catch (err: any) {
        throw new ExecutionError(`Failed to generate types: ${err.message}`);
      }
    });
}
