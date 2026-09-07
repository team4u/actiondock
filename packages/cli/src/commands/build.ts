import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildPlanner, BunCompiler } from "@actiondock/builder";
import {
  findProjectRoot,
  generateStandaloneEntrypoint,
  getPackageSlug,
  resolvePackageRoot,
} from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import { Command } from "commander";

export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description("Build project actions into a single standalone executable")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-t, --target <target>", "Target compilation platform (e.g. bun, linux-x64, darwin-arm64, windows-x64)")
    .option("-o, --out <path>", "Output executable path")
    .option("-a, --actions <actions...>", "Only build specific action(s) into the standalone binary")
    .option("-m, --minify", "Minify bundled JavaScript (default: true)", true)
    .option("--no-minify", "Disable JavaScript minification")
    .option("--bytecode", "Compile JavaScript to bytecode for faster startup (default: true)", true)
    .option("--no-bytecode", "Disable bytecode compilation")
    .action(async (options) => {
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

      console.log("Building standalone executable...");

      // 1. Calculate dependency closure via BuildPlanner
      const plan = BuildPlanner.plan({
        projectRoot: root,
        actions: options.actions,
      });

      if (plan.actions.length === 0) {
        throw new ExecutionError("No actions resolved for standalone compilation");
      }

      // 2. Generate standalone entrypoint
      const buildDir = join(root, ".actiondock", ".build");
      mkdirSync(buildDir, { recursive: true });

      const entryCode = generateStandaloneEntrypoint(
        plan.packageId,
        plan.version,
        plan.description,
        plan.actions.map((a) => ({ id: a.id, filePath: a.resolvedPath })),
        plan.configDefs
      );

      const entryFileName = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`;
      const entryPath = join(buildDir, entryFileName);
      writeFileSync(entryPath, entryCode, "utf-8");

      const binaryName = getPackageSlug(plan.packageId);
      const defaultOutfile = join(root, "dist", binaryName);
      const outfile = resolve(options.out || defaultOutfile);

      try {
        const result = await BunCompiler.compile({
          entrypoint: entryPath,
          outfile,
          target: options.target,
          minify: options.minify,
          bytecode: options.bytecode,
          cwd: root,
          packageId: plan.packageId,
          version: plan.version,
          actions: plan.actions.map((a) => a.id),
        });

        console.log(`[OK] Successfully compiled ${result.packageId || plan.packageId} (v${result.version || plan.version})`);
        console.log(`  Target:     ${result.target}`);
        console.log(`  Actions:    ${plan.actions.map((a) => a.id).join(", ")}`);
        console.log(`  Executable: ${result.executablePath}`);
        if (result.metadataPath) {
          console.log(`  Metadata:   ${result.metadataPath}`);
        }
      } catch (err: any) {
        throw new ExecutionError(`Build failed: ${err.message}`);
      } finally {
        if (existsSync(entryPath)) {
          rmSync(entryPath, { force: true });
        }
      }
    });
}


