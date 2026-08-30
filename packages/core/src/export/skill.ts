import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildProject } from "../build/builder";
import {
  discoverPlaybookFiles,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
} from "../project/loader";
import { generateSkillJson, generateSkillMd } from "./templates";

export interface ExportSkillOptions {
  projectRoot: string;
  target?: string;
  outDir?: string;
  archive?: boolean;
  playbooks?: string[];
  actions?: string[];
}

export interface ExportSkillResult {
  packageId: string;
  version: string;
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
  const target = options.target || "host";

  const actionsMap = await loadActions(root, config.actionsDir);
  const playbooksMap = loadPlaybooks(root, config.playbooksDir);

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

  const targetSuffix = target === "host" ? "" : `-${target}`;
  const skillFolderName = `${pkgSlug}-skill${targetSuffix}`;
  const defaultSkillDir = join(root, "dist", skillFolderName);
  const skillDir = resolve(options.outDir || defaultSkillDir);

  // 1. Create directory structure
  const binDir = join(skillDir, "bin");
  const playbooksDestDir = join(skillDir, "playbooks");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(playbooksDestDir, { recursive: true });

  // 2. Build standalone binary with selected actions
  const binaryName = pkgSlug;
  const binaryPath = join(binDir, binaryName);

  await buildProject({
    projectRoot: root,
    target: options.target,
    outfile: binaryPath,
    actions: selectedActions.map((a) => a.id),
  });

  // 3. Generate SKILL.md
  const skillMd = generateSkillMd(
    config,
    selectedActions,
    selectedPlaybooks,
    `./bin/${binaryName}`
  );
  writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

  // 4. Generate actiondock.skill.json
  const skillJson = generateSkillJson(
    config,
    selectedActions,
    binaryName,
    target
  );
  writeFileSync(join(skillDir, "actiondock.skill.json"), skillJson, "utf-8");

  // 5. Copy selected playbooks
  for (const pb of selectedPlaybooks) {
    if (pb.filePath && existsSync(pb.filePath)) {
      const filename = basename(pb.filePath);
      copyFileSync(pb.filePath, join(playbooksDestDir, filename));
    }
  }

  let archivePath: string | undefined;
  if (options.archive) {
    const zipName = `${skillFolderName}.zip`;
    archivePath = join(dirname(skillDir), zipName);
    // Create zip with zip command or tar
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
    target,
    skillDir,
    archivePath,
    actionsCount: selectedActions.length,
    playbooksCount: selectedPlaybooks.length,
  };
}
