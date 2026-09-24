import { Command } from "commander";
import { ExecutionError } from "../errors";
import { renderResult, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, parseListOption, requirePackageRoot } from "../utils";

export function registerBuildCommand(program: Command, context?: CliContext): void {
  program
    .command("build")
    .description("Build project actions into a runnable Node.js delivery directory")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-o, --out <path>", "Output directory (or archive path)")
    .option("-a, --actions <actions...>", "Only build specific action(s)", parseListOption)
    .option("-p, --playbooks <playbooks...>", "Only build specific playbook(s)", parseListOption)
    .option("-z, --archive", "Create a standard zip archive of the build directory")
    .option("--vendor-deps", "Materialize locked production dependencies into the output")
    .option("--allow-install-scripts", "Allow lifecycle install scripts to run during vendor-deps")
    .option("--require-reproducible", "Require reproducible build and fail if install scripts must run")
    .action(async (rawOptions, cmd) => {
      const options = getEffectiveOptions(rawOptions, cmd);

      const { root } = requirePackageRoot(options.package);

      const isMachine = Boolean(options.json);
      if (!isMachine) {
        writeStdout("Building Node.js delivery artifact...");
      }

      let result;
      try {
        const { buildProject } = await import("@actiondock/builder");
        result = await buildProject({
          projectRoot: root,
          outDir: options.out,
          actions: options.actions,
          playbooks: options.playbooks,
          archive: options.archive,
          vendorDeps: options.vendorDeps,
          allowInstallScripts: options.allowInstallScripts,
          requireReproducible: options.requireReproducible,
        });
      } catch (err: any) {
        if (err?.code === "UNSUPPORTED_BUILD_MODE") {
          throw new ExecutionError(err.message, undefined, "UNSUPPORTED_BUILD_MODE");
        }
        throw new ExecutionError(`Build failed: ${err.message}`);
      }

      renderResult(result, {
        json: isMachine,
        humanFormatter: () => {
          const lines: string[] = [];
          lines.push(`[OK] Successfully built ${result.packageId} (v${result.version})`);
          lines.push(`  Output:       ${result.outputDir}`);
          lines.push(`  Entrypoint:   ${result.entrypointPath}`);
          lines.push(`  Actions:      ${result.actions.join(", ")}`);
          if (result.playbooks.length > 0) {
            lines.push(`  Playbooks:    ${result.playbooks.join(", ")}`);
          }
          lines.push(`  Vendor Deps:  ${result.vendorDeps}`);
          lines.push(`  Reproducible: ${result.reproducible}`);
          if (result.archivePath) {
            lines.push(`  Archive:      ${result.archivePath}`);
          }
          if (result.metadataPath) {
            lines.push(`  Metadata:     ${result.metadataPath}`);
          }
          return lines.join("\n");
        },
        context,
      });
    });
}
