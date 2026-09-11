import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderActionDetail, renderResult } from "../renderer";
import type { CliContext } from "../types";
import {
  getEffectiveOptions,
  resolveLocalPackageRoot,
  withTarget,
} from "../utils";

/**
 * 注册顶层统一 describe 命令：查询指定 Action 的规范结构与模式定义。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerDescribeCommand(program: Command, context?: CliContext): void {
  program
    .command("describe <id>")
    .alias("show")
    .description("Show action definition, schema, and description")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Action ID is required for describe");
      }

      // 目标拓扑解析（仅 local 分支需要包寻址）
      const targetPackageRoot = resolveLocalPackageRoot(options.package);
      if (options.package && !targetPackageRoot) {
        throw new ArgumentError(
          `Package '${options.package}' not found in linked packages or path`
        );
      }

      let targetRef = id;
      if (options.package && !id.includes("/") && !id.includes(":")) {
        targetRef = `${options.package}/${id}`;
      }

      // 通过 Target 门面统一查询 Action 规范
      await withTarget(
        options,
        context,
        async (target) => {
          let spec;
          try {
            spec = await target.describeAction(targetRef);
          } catch (err: any) {
            const msg = err?.message || String(err);
            if (msg.includes("not found") || msg.includes("ACTION_NOT_FOUND")) {
              throw new ArgumentError(msg);
            }
            throw new ExecutionError(msg);
          }

          const detail = {
            id: spec.id,
            description: spec.description,
            inputSchema: spec.inputSchema,
            outputSchema: spec.outputSchema,
            tags: spec.tags,
            annotations: spec.annotations,
            uses: spec.uses,
            entry: spec.entry,
            filePath: spec.filePath,
          };

          renderResult(detail, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => renderActionDetail(detail),
            context,
          });
        },
        { localRoot: targetPackageRoot || undefined, scanLinkedPackages: true }
      );
    });
}
