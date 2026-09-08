import {
  findProjectRoot,
  loadActions,
  loadProjectConfig,
  resolvePackageRoot,
  validateSchema,
} from "@actiondock/core";
import {
  ArgumentError,
  ExecutionError,
  getEffectiveOptions,
  renderResult,
} from "@actiondock/runtime-cli";
import type { Command } from "commander";

export function registerActionValidateCommand(actionCmd: Command): void {
  actionCmd
    .command("validate [id]")
    .description("Validate action schemas and definitions")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id, rawOptions, cmd) => {
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
        throw new ArgumentError("Not in an ActionDock project (actiondock.json not found)");
      }

      try {
        const config = loadProjectConfig(root);
        const actions = await loadActions(root, config.actionsDir);

        const toValidate = id ? [actions.get(id)].filter(Boolean) : Array.from(actions.values());
        if (id && toValidate.length === 0) {
          throw new ArgumentError(`Action '${id}' not found in project`);
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
        renderResult(
          { valid: allValid, results },
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines: string[] = [];
              for (const r of results) {
                if (r.valid) {
                  lines.push(`[OK] ${r.id}: Valid`);
                } else {
                  lines.push(`[FAIL] ${r.id}: ${r.errors.join(", ")}`);
                }
              }
              return lines.join("\n");
            },
          }
        );

        if (!allValid) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) throw err;
        throw new ExecutionError(err.message);
      }
    });
}
