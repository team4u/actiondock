import { buildProject } from "@actiondock/builder";
import { findProjectRoot, resolvePackageRoot } from "@actiondock/core";
import { Command } from "commander";
import { ExecutionError } from "../errors";
import { renderResult, writeStdout } from "../renderer";
import { parseListOption } from "../utils";

export function registerBuildCommand(program: Command): void {
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
    .option("-t, --target <target>", "Target compilation platform (removed)")
    .option("--bytecode", "Bytecode compilation (removed)")
    .action(async (options) => {
      // 彻底删除原有单文件二进制输出语义
      if (options.target !== undefined || options.bytecode !== undefined) {
        throw new ExecutionError(
          "Unsupported build mode: '--target' and '--bytecode' standalone single-file binary compilation have been removed in ActionDock 2.0. Directory-based Node.js builds are now the standard distribution format.",
          undefined,
          "UNSUPPORTED_BUILD_MODE"
        );
      }

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
      if (!isJson) {
        writeStdout("Building Node.js delivery artifact...");
      }

      let result;
      try {
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
        json: isJson,
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
      });
    });
}
