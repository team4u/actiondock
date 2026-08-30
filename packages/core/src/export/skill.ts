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
  const actions = Array.from(actionsMap.values());

  const playbooksMap = loadPlaybooks(root, config.playbooksDir);
  const playbooks = Array.from(playbooksMap.values());

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

  // 2. Build standalone binary
  const binaryName = pkgSlug;
  const binaryPath = join(binDir, binaryName);

  await buildProject({
    projectRoot: root,
    target: options.target,
    outfile: binaryPath,
  });

  // 3. Generate SKILL.md
  const skillMd = generateSkillMd(
    config,
    actions,
    playbooks,
    `./bin/${binaryName}`
  );
  writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

  // 4. Generate actiondock.skill.json
  const skillJson = generateSkillJson(config, actions, binaryName, target);
  writeFileSync(join(skillDir, "actiondock.skill.json"), skillJson, "utf-8");

  // 5. Copy playbooks
  const playbookFiles = discoverPlaybookFiles(root, config.playbooksDir);
  for (const pf of playbookFiles) {
    const filename = basename(pf);
    copyFileSync(pf, join(playbooksDestDir, filename));
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
    actionsCount: actions.length,
    playbooksCount: playbooks.length,
  };
}
