import { exportSkill, findProjectRoot } from "@actiondock/core";
import { Command } from "commander";

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command("export")
    .description("Export project artifacts");

  exportCmd
    .command("skill")
    .description("Export Skill directory for AI Agents (default: source skill; use -s/--standalone for pre-built standalone binary)")
    .option("-s, --standalone", "Export pre-compiled standalone binary skill (for environments without ActionDock runtime)")
    .option("-t, --target <target>", "Target compilation platform for standalone mode (e.g. host, linux-x64, darwin-arm64, windows-x64)")
    .option("-o, --out <path>", "Output skill directory")
    .option("-p, --playbook <playbooks...>", "Only export specific playbook(s) and their dependent actions (Playbook-driven minimal export)")
    .option("-a, --actions <actions...>", "Only export specific action(s)")
    .option("-m, --minify", "Minify bundled JavaScript in standalone mode (default: true)", true)
    .option("--no-minify", "Disable JavaScript minification in standalone mode")
    .option("--bytecode", "Compile JavaScript to bytecode in standalone mode (default: true)", true)
    .option("--no-bytecode", "Disable bytecode compilation in standalone mode")
    .option("-z, --archive", "Create a .zip archive of the exported skill")
    .action(async (options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project (actiondock.json not found)");
        process.exit(1);
      }

      const isStandalone = Boolean(options.standalone);

      try {
        console.log(`Exporting ${isStandalone ? "standalone binary" : "source"} Skill artifact...`);
        const result = await exportSkill({
          projectRoot: root,
          mode: isStandalone ? "standalone" : "source",
          standalone: isStandalone,
          target: options.target,
          outDir: options.out,
          archive: options.archive,
          playbooks: options.playbook,
          actions: options.actions,
          minify: options.minify,
          bytecode: options.bytecode,
        });

        console.log(`[OK] Successfully exported ${result.mode === "standalone" ? "Standalone" : "Source"} Skill: ${result.packageId} (v${result.version})`);
        console.log(`  Mode:       ${result.mode}${result.mode === "standalone" ? ` (target: ${result.target})` : ""}`);
        console.log(`  Actions:    ${result.actionsCount}`);
        console.log(`  Playbooks:  ${result.playbooksCount}`);
        console.log(`  Skill Dir:  ${result.skillDir}`);
        if (result.archivePath) {
          console.log(`  Archive:    ${result.archivePath}`);
        }
      } catch (err: any) {
        console.error(`Export failed: ${err.message}`);
        process.exit(1);
      }
    });
}
