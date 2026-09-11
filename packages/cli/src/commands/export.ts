import { existsSync } from "node:fs";
import { basename } from "node:path";
import { exportCompositeSkill, exportSkill, exportSkillBatch } from "@actiondock/builder";
import { discoverProjects, findProjectRoot, listLinkedPackages, resolvePackageRoot } from "@actiondock/core";
import { Command } from "commander";
import { ExecutionError } from "../errors";
import { renderResult, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, parseListOption } from "../utils";

export function registerExportCommand(program: Command, context?: CliContext): void {
  const exportCmd = program
    .command("export")
    .description("Export project artifacts");

  exportCmd
    .command("skill")
    .description("Export Skill directory for AI Agents (default: source; use -m/--mode node for self-contained Node.js directory)")
    .option(
      "-P, --package <id...>",
      "Target package ID(s) or path(s) (can be specified multiple times or comma-separated)",
      parseListOption,
      []
    )
    .option("--workspace", "Export all packages discovered in current workspace")
    .option("--all", "Export all linked packages from global registry")
    .option(
      "--bundle [name]",
      "Export multiple packages as a unified composite Skill bundle (defaults to workspace directory name if omitted)"
    )
    .option("-m, --mode <mode>", "Skill export mode ('source' or 'node')", "source")
    .option("-s, --standalone", "Export standalone binary skill (removed)")
    .option("-t, --target <target>", "Target compilation platform (removed)")
    .option("--bytecode", "Bytecode compilation (removed)")
    .option("-o, --out <path>", "Output skill directory")
    .option("-p, --playbook <playbooks...>", "Only export specific playbook(s) and their dependent actions", parseListOption)
    .option("-a, --actions <actions...>", "Only export specific action(s)", parseListOption)
    .option("-z, --archive", "Create a .zip archive of the exported skill")
    .option("--skill-md <path>", "Use specified existing SKILL.md file instead of auto-generating")
    .option("--custom-md <path>", "Custom skill declaration (SKILL.custom.md) with slot-marked sections and optional frontmatter description for composite bundles (auto-discovered at workspace root when omitted)")
    .option("--skill-md-only", "Bundle mode only: regenerate only the composite SKILL.md in place (always regenerates, ignores any existing SKILL.md)")
    .option("--vendor-deps", "Materialize locked production dependencies into the exported skill")
    .option("--allow-install-scripts", "Allow lifecycle install scripts to run during dependency materialization")
    .option("--require-reproducible", "Require reproducible build and fail if install scripts must run")
    .action(async (rawOptions, cmd) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      // 彻底删除 --standalone 单文件编译选项
      if (options.standalone || options.target !== undefined || options.bytecode !== undefined) {
        throw new ExecutionError(
          "The '--standalone' option and binary target flags have been removed in ActionDock 2.0. Please use '--mode node' for self-contained Node.js directory skills, or '--mode source' for source-based skills.",
          undefined,
          "UNSUPPORTED_BUILD_MODE"
        );
      }

      const mode = options.mode === "node" ? "node" : "source";

      if (options.bundle && mode === "node") {
        throw new ExecutionError(
          "Composite Skill export (--bundle) currently only supports source mode. Please use '--mode source' to export as a composite workspace Skill."
        );
      }

      if (options.skillMdOnly && options.bundle === undefined) {
        throw new ExecutionError(
          "Option --skill-md-only requires composite bundle mode (--bundle)."
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

      const isMachine = Boolean(options.json || options.envelope);

      try {
        if (options.bundle !== undefined) {
          const bundleName =
            typeof options.bundle === "string" && options.bundle.trim()
              ? options.bundle.trim()
              : basename(process.cwd());
          if (!isMachine) {
            writeStdout(`Exporting composite Skill bundle '${bundleName}' (${roots.length} package${roots.length > 1 ? "s" : ""})...`);
          }
          const result = await exportCompositeSkill({
            bundleName,
            projectRoots: roots,
            outDir: options.out,
            archive: options.archive,
            workspaceRoot: options.workspace ? process.cwd() : undefined,
            skillMdPath: options.skillMd,
            customMdPath: options.customMd,
            skillMdOnly: options.skillMdOnly,
          });

          renderResult(result, {
            json: isMachine,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines: string[] = [];
              lines.push(`[OK] Successfully exported Composite Skill: ${result.bundleName}`);
              lines.push(`  Packages:   ${result.packagesCount}`);
              lines.push(`  Actions:    ${result.actionsCount}`);
              lines.push(`  Playbooks:   ${result.playbooksCount}`);
              lines.push(`  Skill Dir:  ${result.skillDir}`);
              if (result.skillMdFile) {
                lines.push(`  SKILL.md:   Regenerated ${result.skillMdFile}`);
              }
              if (result.usedExistingSkillMd) {
                lines.push(`  SKILL.md:   Reused existing file from ${result.usedExistingSkillMd}`);
              }
              if (result.archivePath) {
                lines.push(`  Archive:    ${result.archivePath}`);
              }
              return lines.join("\n");
            },
            context,
          });
          return;
        }

        if (roots.length > 1) {
          if (!isMachine) {
            writeStdout(`Batch exporting ${roots.length} Skill packages...`);
          }
          const batchRes = await exportSkillBatch({
            projectRoots: roots,
            mode,
            outDir: options.out,
            archive: options.archive,
            playbooks: options.playbook,
            actions: options.actions,
            skillMdPath: options.skillMd,
            vendorDeps: options.vendorDeps,
            allowInstallScripts: options.allowInstallScripts,
            requireReproducible: options.requireReproducible,
          });

          renderResult(batchRes, {
            json: isMachine,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines: string[] = [];
              lines.push(`[OK] Successfully batch exported ${batchRes.results.length} Skill packages to: ${batchRes.outDir}`);
              for (const res of batchRes.results) {
                lines.push(`  - ${res.packageId} (v${res.version}): ${res.actionsCount} actions, ${res.playbooksCount} playbooks -> ${res.skillDir}`);
              }
              lines.push(`  Total Actions:   ${batchRes.totalActions}`);
              lines.push(`  Total Playbooks: ${batchRes.totalPlaybooks}`);
              return lines.join("\n");
            },
            context,
          });
          return;
        }

        const root = roots[0];
        if (!isMachine) {
          writeStdout(`Exporting ${mode === "node" ? "Node.js directory" : "source"} Skill artifact...`);
        }
        const result = await exportSkill({
          projectRoot: root,
          mode,
          outDir: options.out,
          archive: options.archive,
          playbooks: options.playbook,
          actions: options.actions,
          skillMdPath: options.skillMd,
          vendorDeps: options.vendorDeps,
          allowInstallScripts: options.allowInstallScripts,
          requireReproducible: options.requireReproducible,
        });

        renderResult(result, {
          json: isMachine,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines: string[] = [];
            lines.push(`[OK] Successfully exported ${result.mode === "node" ? "Node Directory" : "Source"} Skill: ${result.packageId} (v${result.version})`);
            lines.push(`  Mode:       ${result.mode}`);
            lines.push(`  Actions:    ${result.actionsCount}`);
            lines.push(`  Playbooks:  ${result.playbooksCount}`);
            lines.push(`  Skill Dir:  ${result.skillDir}`);
            if (result.usedExistingSkillMd) {
              lines.push(`  SKILL.md:   Reused existing file from ${result.usedExistingSkillMd}`);
            }
            if (result.archivePath) {
              lines.push(`  Archive:    ${result.archivePath}`);
            }
            return lines.join("\n");
          },
          context,
        });
      } catch (err: any) {
        if (err?.code === "UNSUPPORTED_BUILD_MODE") {
          throw new ExecutionError(err.message, undefined, "UNSUPPORTED_BUILD_MODE");
        }
        throw new ExecutionError(`Export failed: ${err.message}`);
      }
    });
}
