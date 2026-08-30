import { exportSkill, findProjectRoot } from "@actiondock/core";
import { Command } from "commander";

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command("export")
    .description("Export project artifacts");

  exportCmd
    .command("skill")
    .description("Export standalone Skill directory with SKILL.md and pre-built standalone executable")
    .option("-t, --target <target>", "Target compilation platform (e.g. host, linux-x64, darwin-arm64, windows-x64)")
    .option("-o, --out <path>", "Output skill directory")
    .option("-z, --archive", "Create a .zip archive of the exported skill")
    .action(async (options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project (actiondock.json not found)");
        process.exit(1);
      }

      try {
        console.log("Exporting standalone Skill artifact...");
        const result = await exportSkill({
          projectRoot: root,
          target: options.target,
          outDir: options.out,
          archive: options.archive,
        });

        console.log(`✓ Successfully exported Skill: ${result.packageId} (v${result.version})`);
        console.log(`  Target:     ${result.target}`);
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
