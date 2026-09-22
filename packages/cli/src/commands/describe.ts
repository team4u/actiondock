import { Command } from "commander";
import { buildActionDescribePayload, formatActionDetail } from "@actiondock/core";
import { ArgumentError, ExecutionError, packageNotFoundError } from "../errors";
import { renderResult } from "../renderer";
import type { CliContext } from "../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  resolveLocalPackageRoot,
  withTarget,
} from "../utils";

/**
 * 挂载 describe 子命令至指定 Commander 节点。
 * 
 * @param parent 目标 Commander 命令节点
 * @param context 命令行上下文
 */
export function attachDescribeCommand(parent: Command, context?: CliContext): Command {
  const cmd = parent
    .command("describe <id>")
    .alias("show")
    .description("Show action definition, schema, and description")
    .option("-P, --package <id>", "Target package ID or path");

  return applyTargetOptions(cmd)
    .option("--json", "Output as JSON")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Action ID is required for describe");
      }

      // 目标拓扑解析（仅 local 分支需要包寻址）
      const targetPackageRoot = resolveLocalPackageRoot(options.package);
      if (options.package && !targetPackageRoot) {
        throw packageNotFoundError(options.package);
      }

      let targetRef = id;
      if (options.package && !id.includes("/") && !id.includes(":")) {
        const isPath =
          options.package.includes("/") ||
          options.package.includes("\\") ||
          options.package.startsWith(".");
        if (!isPath) {
          targetRef = `${options.package}/${id}`;
        }
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

          const payload = buildActionDescribePayload(spec);

          renderResult(payload, {
            json: options.json,
            humanFormatter: () => formatActionDetail(payload),
            context,
          });
        },
        { localRoot: targetPackageRoot || undefined, scanLinkedPackages: true }
      );
    });
}

/**
 * 注册顶层统一 describe 命令：查询指定 Action 的规范结构与模式定义。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerDescribeCommand(program: Command, context?: CliContext): void {
  attachDescribeCommand(program, context);
}
