import { findProjectRoot, resolvePackageRoot } from "@actiondock/core";
import { Command } from "commander";
import { ExecutionError } from "../errors";
import { renderResult, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions } from "../utils";

export function registerPackCommand(program: Command, context?: CliContext): void {
  program
    .command("pack")
    .description("Pack Action package into a standard npm tarball (.tgz) for distribution")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-o, --out <path>", "Output directory for the .tgz package")
    .option("--dry-run", "Validate and show package summary without creating .tgz")
    .option("--json", "Output as JSON")
    .action(async (rawOptions, cmd) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const root = options.package
        ? resolvePackageRoot(options.package)
        : findProjectRoot();

      if (!root) {
        if (options.package) {
          throw new ExecutionError(`Package '${options.package}' not found in linked packages or path`);
        }
        throw new ExecutionError(
          "Not in an ActionDock project (actiondock.json not found).\nPlease specify -P, --package <id> or cd into a project directory."
        );
      }

      const isMachine = Boolean(options.json || options.envelope);
      if (!isMachine && !options.dryRun) {
        writeStdout("Packing Action package...");
      }

      let result;
      try {
        const { packProject } = await import("@actiondock/builder");
        result = await packProject({
          projectRoot: root,
          outDir: options.out,
          dryRun: options.dryRun,
        });
      } catch (err: any) {
        throw new ExecutionError(`Pack failed: ${err.message}`);
      }

      renderResult(result, {
        json: isMachine,
        envelope: options.envelope,
        humanFormatter: () => {
          const lines: string[] = [];
          if (options.dryRun) {
            lines.push(`[OK] Pack dry-run passed for ${result.packageId} (v${result.version})`);
            lines.push(`  Tarball Name: ${result.tarballName}`);
            lines.push(`  Actions:      ${result.manifestSummary.actions.join(", ")}`);
            lines.push(`  Files Count:  ${result.manifestSummary.filesCount}`);
            lines.push("  Notice: Dry-run mode enabled, no tarball was generated.");
            return lines.join("\n");
          }

          lines.push(`[OK] Successfully packed ${result.packageId} (v${result.version})`);
          lines.push(`  Tarball:   ${result.tarballPath}`);
          lines.push(`  Size:      ${result.sizeBytes} bytes`);
          lines.push(`  SHA-256:   ${result.sha256}`);
          lines.push(`  Actions:   ${result.manifestSummary.actions.join(", ")}`);
          return lines.join("\n");
        },
        context,
      });
    });
}
