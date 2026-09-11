import {
  checkGeneratedTypes,
  findProjectRoot,
  GENERATED_TYPES_OUTDATED_CODE,
  loadActions,
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import { SelectionPlanner } from "@actiondock/builder";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderActionValidation, renderResult } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions } from "../utils";

/**
 * 注册顶层统一 validate 命令：校验 Action 的 Schema 与方法定义完整性。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerValidateCommand(program: Command, context?: CliContext): void {
  program
    .command("validate [id]")
    .description("Validate action schemas and definitions")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (id: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      let root: string | null = null;

      if (options.package) {
        root = resolvePackageRoot(options.package);
        if (!root) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
      } else {
        root = findProjectRoot();
      }

      if (!root) {
        throw new ArgumentError(
          "Not in an ActionDock project (actiondock.json not found).\nPlease specify -P, --package <id> or cd into a project directory."
        );
      }

      const config = loadProjectConfig(root);
      const actions = await loadActions(root, config.actionsDir);

      let toValidate: Array<{ id: string; act: any; spec?: any }> = [];
      if (id) {
        const act = actions.get(id);
        if (!act) {
          throw new ArgumentError(`Action '${id}' not found in project '${config.id}'`);
        }
        toValidate = [{ id, act, spec: config.actions?.[id] }];
      } else {
        toValidate = Array.from(actions.entries()).map(([actId, act]) => ({
          id: actId,
          act,
          spec: config.actions?.[actId],
        }));
      }

      const results: Array<{ id: string; valid: boolean; errors: string[] }> = [];

      for (const item of toValidate) {
        const errors: string[] = [];
        if (!item.id) errors.push("Missing id property");
        if (!item.act?.run || typeof item.act.run !== "function") errors.push("Missing run method");
        const inSchema = item.spec?.inputSchema ?? (item.act as any).inputSchema;
        if (inSchema && typeof inSchema !== "object") {
          errors.push("Invalid inputSchema object");
        }
        const outSchema = item.spec?.outputSchema ?? (item.act as any).outputSchema;
        if (outSchema && typeof outSchema !== "object") {
          errors.push("Invalid outputSchema object");
        }
        results.push({
          id: item.id,
          valid: errors.length === 0,
          errors,
        });
      }

      const allValid = results.every((r) => r.valid);
      const validationPayload = { valid: allValid, results };

      renderResult(validationPayload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderActionValidation(results),
        context,
      });

      if (!allValid) {
        process.exitCode = 1;
        return;
      }

      // 校验 Action 本地相对依赖完整性
      try {
        SelectionPlanner.plan({ projectRoot: root, actions: id ? [id] : undefined });
      } catch (err: any) {
        if (
          err?.code === "UNMET_LOCAL_DEPENDENCY" ||
          err?.code === "EXTERNAL_LOCAL_DEPENDENCY" ||
          err?.code === "FILE_NOT_FOUND"
        ) {
          throw new ExecutionError(
            `Action dependency integrity validation failed:\n${err.message}`,
            undefined,
            err.code
          );
        }
        throw err;
      }

      // 只读校验已生成的类型文件摘要是否过期
      const typeCheck = checkGeneratedTypes(root);
      if (typeCheck.exists && typeCheck.outdated) {
        throw new ExecutionError(
          `Generated types in ${typeCheck.filePath} are outdated. Expected manifest digest '${typeCheck.expectedDigest}', but got '${typeCheck.actualDigest || "none"}'. Run 'ad generate types' to update.`,
          {
            expectedDigest: typeCheck.expectedDigest,
            actualDigest: typeCheck.actualDigest,
          },
          GENERATED_TYPES_OUTDATED_CODE
        );
      }
    });
}
