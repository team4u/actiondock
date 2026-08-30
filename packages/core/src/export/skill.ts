import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildProject } from "../build/builder";
import {
  discoverActionFiles,
  discoverPlaybookFiles,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
} from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { generateSkillJson, generateSkillMd, generateSourceSkillMd, generateStandaloneSkillMd } from "./templates";

export interface ExportSkillOptions {
  projectRoot: string;
  mode?: "source" | "standalone";
  standalone?: boolean;
  target?: string;
  outDir?: string;
  archive?: boolean;
  playbooks?: string[];
  actions?: string[];
}

export interface ExportSkillResult {
  packageId: string;
  version: string;
  mode: "source" | "standalone";
  target: string;
  skillDir: string;
  archivePath?: string;
  actionsCount: number;
  playbooksCount: number;
}

export async function exportSkill(
  options: ExportSkillOptions
): Promise<ExportSkillResult> {
  const root = resolve(options.projectRoot);
  const config = loadProjectConfig(root);
  const mode: "source" | "standalone" =
    options.standalone || options.mode === "standalone" ? "standalone" : "source";
  const target = options.target || "host";

  const actionsMap = await loadActions(root, config.actionsDir);
  const playbooksMap = loadPlaybooks(root, config.playbooksDir);

  // Map each action ID to its corresponding source file path
  const actionFiles = discoverActionFiles(root, config.actionsDir);
  const actionFileMap = new Map<string, string>();
  for (const file of actionFiles) {
    try {
      const imported = await import(file);
      const act = imported.default || imported.action;
      if (act && typeof act.id === "string") {
        actionFileMap.set(act.id, resolve(file));
      }
    } catch {
      // Ignore files that cannot be imported
    }
  }

  let selectedPlaybooks = Array.from(playbooksMap.values());
  let selectedActions = Array.from(actionsMap.values());

  // 1. If playbooks are explicitly specified (Playbook-driven minimal export)
  if (options.playbooks && options.playbooks.length > 0) {
    const specifiedPlaybookIds = new Set(options.playbooks);
    const pbList = [];
    for (const id of specifiedPlaybookIds) {
      const pb = playbooksMap.get(id);
      if (!pb) {
        throw new Error(
          `Playbook '${id}' specified in export options not found in project`
        );
      }
      pbList.push(pb);
    }
    selectedPlaybooks = pbList;

    // If actions were not explicitly specified, derive required actions from selected playbooks
    if (!options.actions || options.actions.length === 0) {
      const requiredActions = new Set<string>();
      for (const pb of selectedPlaybooks) {
        if (pb.actions) {
          for (const act of pb.actions) {
            requiredActions.add(act);
          }
        }
      }
      if (requiredActions.size > 0) {
        for (const actId of requiredActions) {
          if (!actionsMap.has(actId)) {
            console.warn(
              `[WARN] Action '${actId}' referenced in playbook is not found in project`
            );
          }
        }
        selectedActions = Array.from(actionsMap.values()).filter((a) =>
          requiredActions.has(a.id)
        );
      }
    }
  }

  // 2. If actions are explicitly specified (Action-driven export)
  if (options.actions && options.actions.length > 0) {
    const specifiedActionIds = new Set(options.actions);
    for (const actId of specifiedActionIds) {
      if (!actionsMap.has(actId)) {
        throw new Error(
          `Action '${actId}' specified in export options not found in project`
        );
      }
    }
    selectedActions = Array.from(actionsMap.values()).filter((a) =>
      specifiedActionIds.has(a.id)
    );

    // If playbooks were not explicitly specified, tree-shake playbooks whose required actions are not included
    if (!options.playbooks || options.playbooks.length === 0) {
      selectedPlaybooks = selectedPlaybooks.filter((pb) => {
        if (!pb.actions || pb.actions.length === 0) return true;
        return pb.actions.every((a) => specifiedActionIds.has(a));
      });
    }
  }

  const pkgSlug = config.id.includes("/")
    ? config.id.split("/").pop()!
    : config.id.includes(".")
    ? config.id.split(".").pop()!
    : config.id;

  const targetSuffix = mode === "standalone" && target !== "host" ? `-${target}` : "";
  const skillFolderName = `${pkgSlug}-skill${targetSuffix}`;
  const defaultSkillDir = join(root, "dist", skillFolderName);
  const skillDir = resolve(options.outDir || defaultSkillDir);

  const playbooksDestDir = join(skillDir, "playbooks");

  if (mode === "source") {
    // ----------------------------------------------------
    // SOURCE SKILL EXPORT (Default)
    // Structure: SKILL.md + actiondock.json + package.json + actions/* + playbooks/*
    // ----------------------------------------------------
    const actionsDestDir = join(skillDir, "actions");
    mkdirSync(actionsDestDir, { recursive: true });
    if (selectedPlaybooks.length > 0) {
      mkdirSync(playbooksDestDir, { recursive: true });
    }

    // 1. Generate SKILL.md for Source Package
    const skillMd = generateSourceSkillMd(
      config,
      selectedActions,
      selectedPlaybooks
    );
    writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

    // 2. Export tailored actiondock.json
    const exportedConfig: Partial<ProjectConfig> = {
      id: config.id,
      name: config.name,
      version: config.version,
      description: config.description,
      actionsDir: "actions",
      playbooksDir: "playbooks",
    };
    if (config.config) {
      exportedConfig.config = config.config;
    }
    writeFileSync(
      join(skillDir, "actiondock.json"),
      JSON.stringify(exportedConfig, null, 2) + "\n",
      "utf-8"
    );

    // 3. Export package.json
    const projectPkgJsonPath = join(root, "package.json");
    if (existsSync(projectPkgJsonPath)) {
      try {
        const rawPkg = readFileSync(projectPkgJsonPath, "utf-8");
        const parsedPkg = JSON.parse(rawPkg);
        const exportedPkg = {
          name: parsedPkg.name || pkgSlug,
          version: config.version || parsedPkg.version || "0.1.0",
          description: config.description || parsedPkg.description,
          type: "module",
          dependencies: parsedPkg.dependencies || {
            "@actiondock/sdk": "^2.0.0",
          },
          devDependencies: parsedPkg.devDependencies,
        };
        writeFileSync(
          join(skillDir, "package.json"),
          JSON.stringify(exportedPkg, null, 2) + "\n",
          "utf-8"
        );
      } catch {
        copyFileSync(projectPkgJsonPath, join(skillDir, "package.json"));
      }
    } else {
      const minimalPkg = {
        name: pkgSlug,
        version: config.version,
        description: config.description,
        type: "module",
        dependencies: {
          "@actiondock/sdk": "^2.0.0",
        },
      };
      writeFileSync(
        join(skillDir, "package.json"),
        JSON.stringify(minimalPkg, null, 2) + "\n",
        "utf-8"
      );
    }

    // 4. Copy tsconfig.json if available
    const tsconfigPath = join(root, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      copyFileSync(tsconfigPath, join(skillDir, "tsconfig.json"));
    }

    // 5. Copy selected action source files
    for (const act of selectedActions) {
      const srcPath = actionFileMap.get(act.id);
      if (srcPath && existsSync(srcPath)) {
        copyFileSync(srcPath, join(actionsDestDir, basename(srcPath)));
      }
    }

    // 6. Copy selected playbooks
    for (const pb of selectedPlaybooks) {
      if (pb.filePath && existsSync(pb.filePath)) {
        const filename = basename(pb.filePath);
        copyFileSync(pb.filePath, join(playbooksDestDir, filename));
      }
    }
  } else {
    // ----------------------------------------------------
    // STANDALONE SKILL EXPORT (--standalone)
    // Structure: SKILL.md + actiondock.skill.json + bin/<binary> + playbooks/*
    // ----------------------------------------------------
    const binDir = join(skillDir, "bin");
    mkdirSync(binDir, { recursive: true });
    if (selectedPlaybooks.length > 0) {
      mkdirSync(playbooksDestDir, { recursive: true });
    }

    const binaryName = pkgSlug;
    const binaryPath = join(binDir, binaryName);

    // Build standalone binary with selected actions
    await buildProject({
      projectRoot: root,
      target: options.target,
      outfile: binaryPath,
      actions: selectedActions.map((a) => a.id),
    });

    // Generate SKILL.md for Standalone Binary
    const skillMd = generateStandaloneSkillMd(
      config,
      selectedActions,
      selectedPlaybooks,
      `./bin/${binaryName}`
    );
    writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

    // Generate actiondock.skill.json
    const skillJson = generateSkillJson(
      config,
      selectedActions,
      binaryName,
      target
    );
    writeFileSync(join(skillDir, "actiondock.skill.json"), skillJson, "utf-8");

    // Copy selected playbooks
    for (const pb of selectedPlaybooks) {
      if (pb.filePath && existsSync(pb.filePath)) {
        const filename = basename(pb.filePath);
        copyFileSync(pb.filePath, join(playbooksDestDir, filename));
      }
    }
  }

  let archivePath: string | undefined;
  if (options.archive) {
    const zipName = `${skillFolderName}.zip`;
    archivePath = join(dirname(skillDir), zipName);
    const zipProc = Bun.spawnSync(
      ["zip", "-r", archivePath, basename(skillDir)],
      {
        cwd: dirname(skillDir),
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    if (zipProc.exitCode !== 0) {
      console.warn(
        `[WARN] Failed to create zip archive: ${zipProc.stderr.toString()}`
      );
      archivePath = undefined;
    }
  }

  return {
    packageId: config.id,
    version: config.version,
    mode,
    target,
    skillDir,
    archivePath,
    actionsCount: selectedActions.length,
    playbooksCount: selectedPlaybooks.length,
  };
}

