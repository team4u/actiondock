import { buildProject, findProjectRoot } from "@actiondock/core";
import { Command } from "commander";

export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description("Build project actions into a single standalone executable")
    .option("-t, --target <target>", "Target compilation platform (e.g. bun, linux-x64, darwin-arm64, windows-x64)")
    .option("-o, --out <path>", "Output executable path")
    .option("-a, --actions <actions...>", "Only build specific action(s) into the standalone binary")
    .option("-m, --minify", "Minify bundled JavaScript (default: true)", true)
    .option("--no-minify", "Disable JavaScript minification")
    .option("--bytecode", "Compile JavaScript to bytecode for faster startup (default: true)", true)
    .option("--no-bytecode", "Disable bytecode compilation")
    .action(async (options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project (actiondock.json not found)");
        process.exit(1);
      }

      try {
        console.log("Building standalone executable...");
        const result = await buildProject({
          projectRoot: root,
          target: options.target,
          outfile: options.out,
          minify: options.minify,
          bytecode: options.bytecode,
          actions: options.actions,
        });

        console.log(`[OK] Successfully compiled ${result.packageId} (v${result.version})`);
        console.log(`  Target:     ${result.target}`);
        console.log(`  Actions:    ${result.actions.join(", ")}`);
        console.log(`  Executable: ${result.executablePath}`);
        console.log(`  Metadata:   ${result.metadataPath}`);
      } catch (err: any) {
        console.error(`Build failed: ${err.message}`);
        process.exit(1);
      }
    });
}
