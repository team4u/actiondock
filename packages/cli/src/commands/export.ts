import { existsSync } from "node:fs";
import { exportCompositeSkill, exportSkill, exportSkillBatch } from "@actiondock/builder";
import { discoverProjects, findProjectRoot, listLinkedPackages, resolvePackageRoot } from "@actiondock/core";
import { ExecutionError } from "@actiondock/runtime-cli";
import { Command } from "commander";

function parseListOption(val: string, prev: string[] = []): string[] {
  const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
  return [...prev, ...parts];
}

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command("export")
    .description("Export project artifacts");

  exportCmd
    .command("skill")
    .description("Export Skill directory for AI Agents (default: source skill; use -s/--standalone for pre-built standalone binary)")
    .option(
      "-P, --package <id...>",
      "Target package ID(s) or path(s) (can be specified multiple times or comma-separated)",
      parseListOption,
      []
    )
    .option("--workspace", "Export all packages discovered in current workspace")
    .option("--all", "Export all linked packages from global registry")
    .option("--bundle <name>", "Export multiple packages as a unified composite Skill bundle")
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
    .option("--skill-md <path>", "Use specified existing SKILL.md file instead of auto-generating")
    .action(async (options) => {
      const isStandalone = Boolean(options.standalone);

      if (options.bundle && isStandalone) {
        throw new ExecutionError(
          "Composite Skill export (--bundle) currently only supports source mode. Please remove --standalone to export as a composite workspace Skill."
        );
      }

      const sourceCount =
        (options.all ? 1 : 0) +
        (options.workspace ? 1 : 0) +
        (options.package && options.package.length > 0 ? 1 : 0);
      if (sourceCount > 1) {
        throw new ExecutionError(
          "Options -P/--package, --workspace, and --all are mutually exclusive. Please specify only one package selection mode."
        );
      }

      let roots: string[] = [];

      if (options.all) {
        const linked = listLinkedPackages();
        roots = linked.map((p) => p.path).filter((p) => existsSync(p));
        if (roots.length === 0) {
          throw new ExecutionError("No linked packages found in global registry.");
        }
      } else if (options.workspace) {
        const cwd = process.cwd();
        const discovered = discoverProjects(cwd);
        roots = discovered.length > 0 ? discovered : (findProjectRoot(cwd) ? [findProjectRoot(cwd)!] : []);
        if (roots.length === 0) {
          throw new ExecutionError(
            `No ActionDock packages found in workspace '${cwd}'.\nMake sure child directories contain actiondock.json.`
          );
        }
      } else if (options.package && options.package.length > 0) {
        for (const pkgIdOrPath of options.package) {
          const root = resolvePackageRoot(pkgIdOrPath);
          if (!root) {
            throw new ExecutionError(`Package '${pkgIdOrPath}' not found in linked packages or path`);
          }
          if (!roots.includes(root)) {
            roots.push(root);
          }
        }
      } else {
        const root = findProjectRoot();
        if (root) {
          roots.push(root);
        } else {
          throw new ExecutionError(
            "Not in an ActionDock project (actiondock.json not found).\nPlease specify -P, --package <id>, --workspace, --all, or cd into a project directory."
          );
        }
      }

      if (roots.length > 1 && (options.actions || options.playbook)) {
        throw new ExecutionError(
          "Filtering options (--actions, --playbook) can only be used when exporting a single package."
        );
      }

      try {
        if (options.bundle) {
          console.log(`Exporting composite Skill bundle '${options.bundle}' (${roots.length} package${roots.length > 1 ? "s" : ""})...`);
          const result = await exportCompositeSkill({
            bundleName: options.bundle,
            projectRoots: roots,
            outDir: options.out,
            archive: options.archive,
            workspaceRoot: options.workspace ? process.cwd() : undefined,
            skillMdPath: options.skillMd,
          });

          console.log(`[OK] Successfully exported Composite Skill: ${result.bundleName}`);
          console.log(`  Packages:   ${result.packagesCount}`);
          console.log(`  Actions:    ${result.actionsCount}`);
          console.log(`  Playbooks:  ${result.playbooksCount}`);
          console.log(`  Skill Dir:  ${result.skillDir}`);
          if (result.usedExistingSkillMd) {
            console.log(`  SKILL.md:   Reused existing file from ${result.usedExistingSkillMd}`);
          }
          if (result.archivePath) {
            console.log(`  Archive:    ${result.archivePath}`);
          }
          return;
        }

        if (roots.length > 1) {
          console.log(`Batch exporting ${roots.length} Skill packages...`);
          const batchRes = await exportSkillBatch({
            projectRoots: roots,
            mode: isStandalone ? "standalone" : "source",
            standalone: isStandalone,
            target: options.target,
            outDir: options.out,
            archive: options.archive,
            playbooks: options.playbook,
            actions: options.actions,
            minify: options.minify,
            bytecode: options.bytecode,
            skillMdPath: options.skillMd,
          });

          console.log(`[OK] Successfully batch exported ${batchRes.results.length} Skill packages to: ${batchRes.outDir}`);
          for (const res of batchRes.results) {
            console.log(`  - ${res.packageId} (v${res.version}): ${res.actionsCount} actions, ${res.playbooksCount} playbooks -> ${res.skillDir}`);
          }
          console.log(`  Total Actions:   ${batchRes.totalActions}`);
          console.log(`  Total Playbooks: ${batchRes.totalPlaybooks}`);
          return;
        }

        const root = roots[0];
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
          skillMdPath: options.skillMd,
        });

        console.log(`[OK] Successfully exported ${result.mode === "standalone" ? "Standalone" : "Source"} Skill: ${result.packageId} (v${result.version})`);
        console.log(`  Mode:       ${result.mode}${result.mode === "standalone" ? ` (target: ${result.target})` : ""}`);
        console.log(`  Actions:    ${result.actionsCount}`);
        console.log(`  Playbooks:  ${result.playbooksCount}`);
        console.log(`  Skill Dir:  ${result.skillDir}`);
        if (result.usedExistingSkillMd) {
          console.log(`  SKILL.md:   Reused existing file from ${result.usedExistingSkillMd}`);
        }
        if (result.archivePath) {
          console.log(`  Archive:    ${result.archivePath}`);
        }
      } catch (err: any) {
        throw new ExecutionError(`Export failed: ${err.message}`);
      }
    });
}



