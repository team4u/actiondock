import { Command } from "commander";
import {
  buildActionDescribePayload,
  formatActionDetail,
  ACTION_NOT_FOUND,
  PACKAGE_NOT_FOUND,
  NOT_FOUND,
} from "@actiondock/core";
import { ArgumentError, ExecutionError, packageNotFoundError } from "../errors";
import { renderResult } from "../renderer";
import type { CliContext } from "../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  resolveLocalPackageRoot,
  withService,
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

      const targetRef = id;

      // 通过 Service 门面统一查询 Action 规范
      await withService(
        options,
        context,
        async (service) => {
          let spec;
          try {
            spec = await service.discovery.describeAction(targetRef);
          } catch (err: any) {
            const code = err?.code;
            if (code === ACTION_NOT_FOUND || code === NOT_FOUND || code === PACKAGE_NOT_FOUND) {
              throw new ArgumentError(err?.message || String(err), err?.details, code);
            }
            throw new ExecutionError(err?.message || String(err), err?.details, code);
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
