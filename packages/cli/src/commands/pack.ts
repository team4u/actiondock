import { packProject } from "@actiondock/builder";
import { findProjectRoot, resolvePackageRoot } from "@actiondock/core";
import { Command } from "commander";
import { ExecutionError } from "../errors";
import { getEffectiveOptions } from "../utils";

export function registerPackCommand(program: Command): void {
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

      const isJson = Boolean(options.json);
      if (!isJson && !options.dryRun) {
        console.log("Packing Action package...");
      }

      let result;
      try {
        result = await packProject({
          projectRoot: root,
          outDir: options.out,
          dryRun: options.dryRun,
        });
      } catch (err: any) {
        throw new ExecutionError(`Pack failed: ${err.message}`);
      }

      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.dryRun) {
        console.log(`[OK] Pack dry-run passed for ${result.packageId} (v${result.version})`);
        console.log(`  Tarball Name: ${result.tarballName}`);
        console.log(`  Actions:      ${result.manifestSummary.actions.join(", ")}`);
        console.log(`  Files Count:  ${result.manifestSummary.filesCount}`);
        console.log("  Notice: Dry-run mode enabled, no tarball was generated.");
        return;
      }

      console.log(`[OK] Successfully packed ${result.packageId} (v${result.version})`);
      console.log(`  Tarball:   ${result.tarballPath}`);
      console.log(`  Size:      ${result.sizeBytes} bytes`);
      console.log(`  SHA-256:   ${result.sha256}`);
      console.log(`  Actions:   ${result.manifestSummary.actions.join(", ")}`);
    });
}
