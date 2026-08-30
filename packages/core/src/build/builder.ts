import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadActionFileMap, loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { getPackageSlug } from "../utils";
import { type ActionImport, generateStandaloneEntrypoint } from "./templates";

export interface BuildOptions {
  projectRoot: string;
  target?: string;
  outfile?: string;
  minify?: boolean;
  bytecode?: boolean;
  actions?: string[];
}

export interface BuildResult {
  packageId: string;
  version: string;
  target: string;
  executablePath: string;
  metadataPath: string;
  actions: string[];
}

export async function buildProject(options: BuildOptions): Promise<BuildResult> {
  const root = resolve(options.projectRoot);
  const config = loadProjectConfig(root);
  const actionsMap = await loadActions(root, config.actionsDir);

  if (actionsMap.size === 0) {
    throw new Error(`No valid actions found in ${join(root, config.actionsDir || "actions")}`);
  }

  if (options.actions && options.actions.length > 0) {
    const requestedActions = new Set(options.actions);
    for (const reqId of requestedActions) {
      if (!actionsMap.has(reqId)) {
        throw new Error(`Action '${reqId}' requested in build options not found in project`);
      }
    }
    for (const id of Array.from(actionsMap.keys())) {
      if (!requestedActions.has(id)) {
        actionsMap.delete(id);
      }
    }
  }

  // Action imports list
  const actionFileMap = await loadActionFileMap(root, config.actionsDir);
  const actionImports: ActionImport[] = [];

  for (const [id, entry] of actionFileMap.entries()) {
    if (actionsMap.has(id)) {
      actionImports.push({
        id,
        filePath: entry.filePath,
      });
    }
  }

  if (actionImports.length === 0) {
    throw new Error("Could not map any action files for build");
  }

  // Create build dir
  const buildDir = join(root, ".actiondock", ".build");
  mkdirSync(buildDir, { recursive: true });

  const entryCode = generateStandaloneEntrypoint(
    config.id,
    config.version,
    config.description,
    actionImports,
    config.config
  );
  const entryPath = join(buildDir, "entry.ts");
  writeFileSync(entryPath, entryCode, "utf-8");

  // Determine target and outfile
  const target = options.target || "bun";
  const binaryName = getPackageSlug(config.id);

  const defaultOutfile = join(root, "dist", binaryName);
  const outfile = resolve(options.outfile || defaultOutfile);

  mkdirSync(dirname(outfile), { recursive: true });

  // Run bun build --compile --bytecode --minify
  const buildArgs = [
    "bun",
    "build",
    entryPath,
    "--compile",
    "--outfile",
    outfile,
  ];

  if (options.bytecode !== false) {
    buildArgs.push("--bytecode");
  }

  if (options.minify !== false) {
    buildArgs.push("--minify");
  }

  if (options.target && options.target !== "bun" && options.target !== "host") {
    // e.g. bun-linux-x64 or linux-x64
    const formattedTarget = options.target.startsWith("bun-")
      ? options.target
      : `bun-${options.target}`;
    buildArgs.push(`--target=${formattedTarget}`);
  }

  const proc = Bun.spawnSync(buildArgs, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const errText = proc.stderr.toString() || proc.stdout.toString();
    throw new Error(`Bun compile failed (exit code ${proc.exitCode}):\n${errText}`);
  }

  // Calculate build hash
  const binaryBuffer = readFileSync(outfile);
  const buildHash = createHash("sha256").update(binaryBuffer).digest("hex").slice(0, 16);

  // Calculate lockHash
  let lockHash = "none";
  const lockFiles = ["bun.lock", "bun.lockb", "package.json"];
  for (const lf of lockFiles) {
    const p = join(root, lf);
    if (existsSync(p)) {
      lockHash = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
      break;
    }
  }

  // Generate artifact.json metadata
  const metadata = {
    packageId: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    target: options.target || "host",
    actions: actionImports.map((a) => a.id),
    bunVersion: Bun.version,
    lockHash,
    buildHash,
    createdAt: new Date().toISOString(),
  };

  const metadataPath = join(dirname(outfile), "artifact.json");
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n", "utf-8");

  return {
    packageId: config.id,
    version: config.version,
    target: options.target || "host",
    executablePath: outfile,
    metadataPath,
    actions: metadata.actions,
  };
}
