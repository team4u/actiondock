import { findProjectRoot, loadActions, loadProjectConfig, validateSchema } from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import type { Command } from "commander";

export function registerActionValidateCommand(actionCmd: Command): void {
  actionCmd
    .command("validate [id]")
    .description("Validate action schemas and definitions")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      const root = findProjectRoot();
      if (!root) {
        throw new ExecutionError("Not in an ActionDock project");
      }
      try {
        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);

        const toValidate = id ? [actions.get(id)].filter(Boolean) : Array.from(actions.values());
        if (id && toValidate.length === 0) {
          throw new ExecutionError(`Action '${id}' not found in project`);
        }

        const results: Array<{ id: string; valid: boolean; errors: string[] }> = [];

        for (const act of toValidate as any[]) {
          const errors: string[] = [];
          if (!act.id) errors.push("Missing id property");
          if (!act.run || typeof act.run !== "function") errors.push("Missing run method");
          if (act.inputSchema) {
            validateSchema(act.inputSchema, {});
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
        if (!allValid) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        if (err instanceof ExecutionError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
