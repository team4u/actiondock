import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import YAML from "yaml";
import type { ActionDefinition } from "@actiondock/sdk";
import type { PlaybookDefinition, PlaybookFrontmatter, ProjectConfig } from "./types";

export function findProjectRoot(cwd?: string): string | null {
  let current: string;
  try {
    current = resolve(cwd || process.cwd());
  } catch {
    return null;
  }
  while (true) {
    try {
      const configPath = join(current, "actiondock.json");
      if (existsSync(configPath)) {
        return current;
      }
    } catch {
      return null;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = join(projectRoot, "actiondock.json");
  if (!existsSync(configPath)) {
    throw new Error(`actiondock.json not found in ${projectRoot}`);
  }
  const content = readFileSync(configPath, "utf-8");
  try {
    const parsed = JSON.parse(content);
    if (!parsed.id || typeof parsed.id !== "string") {
      throw new Error("actiondock.json missing required 'id' field");
    }
    if (!parsed.name || typeof parsed.name !== "string") {
      parsed.name = parsed.id;
    }
    if (!parsed.version || typeof parsed.version !== "string") {
      parsed.version = "0.1.0";
    }
    parsed.actionsDir = parsed.actionsDir || "actions";
    parsed.playbooksDir = parsed.playbooksDir || "playbooks";
    return parsed as ProjectConfig;
  } catch (err: any) {
    throw new Error(`Failed to parse actiondock.json: ${err.message}`);
  }
}

export function ensureProjectDependencies(projectRoot: string, force = false): boolean {
  if (process.env.ACTIONDOCK_AUTO_INSTALL === "false") {
    return false;
  }
  const pkgJsonPath = join(projectRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return false;
  }

  const nodeModulesPath = join(projectRoot, "node_modules");
  if (!force && existsSync(nodeModulesPath)) {
    return false;
  }

  try {
    const raw = readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(raw);
    const hasDeps =
      (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
      (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);

    if (!hasDeps && !force) {
      return false;
    }

    process.stderr.write(
      `[actiondock] Installing dependencies for '${pkg.name || basename(projectRoot)}'...\n`
    );

    const proc = Bun.spawnSync(["bun", "install"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (proc.exitCode !== 0) {
      const errText = proc.stderr?.toString() || "Unknown error during bun install";
      process.stderr.write(`[actiondock] Warning: Dependency installation failed: ${errText}\n`);
      return false;
    }

    process.stderr.write(`[actiondock] Dependencies installed successfully.\n`);
    return true;
  } catch (err: any) {
    process.stderr.write(`[actiondock] Warning: Failed to run auto-install: ${err.message}\n`);
    return false;
  }
}

function scanFiles(dir: string, extension: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];

  function walk(current: string) {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && fullPath.endsWith(extension)) {
        // Exclude test files
        if (
          !fullPath.endsWith(".test.ts") &&
          !fullPath.endsWith(".spec.ts") &&
          !fullPath.endsWith(".d.ts")
        ) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

export function discoverActionFiles(
  projectRoot: string,
  actionsDir = "actions"
): string[] {
  const fullDir = join(projectRoot, actionsDir);
  return scanFiles(fullDir, ".ts");
}

export async function loadActions(
  projectRoot: string,
  actionsDir = "actions",
  options: { autoInstall?: boolean } = { autoInstall: true }
): Promise<Map<string, ActionDefinition>> {
  if (options.autoInstall !== false) {
    ensureProjectDependencies(projectRoot);
  }

  const files = discoverActionFiles(projectRoot, actionsDir);
  const actions = new Map<string, ActionDefinition>();

  for (const file of files) {
    try {
      // Dynamic import with auto-install retry on missing module
      let imported: any;
      try {
        imported = await import(file);
      } catch (err: any) {
        const msg = String(err.message || "");
        if (
          options.autoInstall !== false &&
          (msg.includes("Cannot find package") ||
            msg.includes("Cannot find module") ||
            msg.includes("ERR_MODULE_NOT_FOUND") ||
            msg.includes("Could not resolve"))
        ) {
          const installed = ensureProjectDependencies(projectRoot, true);
          if (installed) {
            imported = await import(file);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const action = imported.default || imported.action;
      if (action && typeof action === "object" && typeof action.id === "string") {
        if (actions.has(action.id)) {
          throw new Error(
            `Duplicate action ID '${action.id}' found in ${file} (previously loaded)`
          );
        }
        actions.set(action.id, action);
      } else {
        console.warn(
          `[WARN] File ${file} does not export a valid default ActionDefinition`
        );
      }
    } catch (err: any) {
      throw new Error(`Failed to load action from ${file}: ${err.message}`);
    }
  }

  return actions;
}

export function discoverPlaybookFiles(
  projectRoot: string,
  playbooksDir = "playbooks"
): string[] {
  const fullDir = join(projectRoot, playbooksDir);
  return scanFiles(fullDir, ".md");
}

export function parsePlaybookContent(
  content: string,
  filePath: string
): PlaybookDefinition {
  let frontmatter: Partial<PlaybookFrontmatter> = {};
  let body = content;

  // Check for YAML frontmatter delimited by ---
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (match) {
    try {
      frontmatter = YAML.parse(match[1]) || {};
      body = match[2];
    } catch (err: any) {
      console.warn(`[WARN] Failed to parse frontmatter in ${filePath}: ${err.message}`);
    }
  }

  const filename = filePath.split("/").pop() || "unknown";
  const defaultId = filename.replace(/\.md$/, "");

  return {
    id: frontmatter.id || defaultId,
    description: frontmatter.description,
    actions: Array.isArray(frontmatter.actions) ? frontmatter.actions : [],
    content: body.trim(),
    filePath,
  };
}

export function loadPlaybooks(
  projectRoot: string,
  playbooksDir = "playbooks"
): Map<string, PlaybookDefinition> {
  const files = discoverPlaybookFiles(projectRoot, playbooksDir);
  const playbooks = new Map<string, PlaybookDefinition>();

  for (const file of files) {
    try {
      const content = readFileSync(file, "utf-8");
      const playbook = parsePlaybookContent(content, file);
      if (playbooks.has(playbook.id)) {
        throw new Error(
          `Duplicate playbook ID '${playbook.id}' found in ${file}`
        );
      }
      playbooks.set(playbook.id, playbook);
    } catch (err: any) {
      throw new Error(`Failed to load playbook from ${file}: ${err.message}`);
    }
  }

  return playbooks;
}
