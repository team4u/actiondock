import { existsSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, loadActions, loadPlaybooks, loadProjectConfig } from "../project/loader";
import { getRegistryStatus } from "../registry/registry";
import { createGlobalStorage, createStorage } from "../storage";
import { getActionDockHome } from "../utils";
import type { DoctorCheckItem, DoctorReport } from "./types";

function compareSemver(v1: string, v2: string): number {
  const p1 = v1.replace(/^v/, "").split(".").map(Number);
  const p2 = v2.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export async function runDoctorChecks(options?: {
  cwd?: string;
  packageIdOrPath?: string;
  customHome?: string;
}): Promise<DoctorReport> {
  const cwd = options?.cwd || process.cwd();
  const checks: DoctorCheckItem[] = [];

  // 1. Check Bun Runtime
  const bunVersion = (typeof Bun !== "undefined" && Bun.version) || (process.versions as any).bun;
  if (bunVersion) {
    const isGte11 = compareSemver(bunVersion, "1.1.0") >= 0;
    if (isGte11) {
      checks.push({
        id: "runtime.bun",
        category: "runtime",
        name: "Bun Runtime",
        status: "ok",
        message: `v${bunVersion} (>= 1.1.0 required)`,
      });
    } else {
      checks.push({
        id: "runtime.bun",
        category: "runtime",
        name: "Bun Runtime",
        status: "error",
        message: `v${bunVersion} is too old (>= 1.1.0 required)`,
        fix: "Run 'bun upgrade' to update Bun",
      });
    }
  } else {
    checks.push({
      id: "runtime.bun",
      category: "runtime",
      name: "Bun Runtime",
      status: "error",
      message: "Bun runtime not detected",
      fix: "Install Bun via 'curl -fsSL https://bun.sh/install | bash'",
    });
  }

  // 2. Check CLI in PATH
  let acPath: string | null = null;
  try {
    acPath = typeof Bun !== "undefined" && Bun.which ? Bun.which("ac") : null;
  } catch {
    // ignore
  }

  if (acPath) {
    checks.push({
      id: "runtime.cli",
      category: "runtime",
      name: "CLI Executable",
      status: "ok",
      message: `Found 'ac' in PATH at ${acPath}`,
    });
  } else {
    checks.push({
      id: "runtime.cli",
      category: "runtime",
      name: "CLI Executable",
      status: "warn",
      message: "'ac' command not found in PATH",
      fix: "Run 'bun add -g @actiondock/cli' or in SDK workspace run 'cd packages/cli && bun link'",
    });
  }

  // 3. Check Global Storage
  const globalHome = getActionDockHome(options?.customHome);
  try {
    const globalStorage = createGlobalStorage(options?.customHome);
    await globalStorage.setConfig("_doctor_probe_", "ok");
    await globalStorage.deleteConfig("_doctor_probe_");
    globalStorage.close();

    checks.push({
      id: "storage.global",
      category: "storage",
      name: "Global Storage",
      status: "ok",
      message: `Database writable at ${join(globalHome, ".actiondock", "global.db")}`,
    });
  } catch (err: any) {
    checks.push({
      id: "storage.global",
      category: "storage",
      name: "Global Storage",
      status: "error",
      message: `Failed to write global database: ${err.message}`,
      fix: `Check write permissions for directory '${join(globalHome, ".actiondock")}'`,
    });
  }

  // 4. Check Global Registry Health
  try {
    const regStatus = getRegistryStatus(options?.customHome);
    if (regStatus.staleCount > 0) {
      checks.push({
        id: "registry.global",
        category: "registry",
        name: "Global Registry",
        status: "warn",
        message: `${regStatus.totalPackagesCount} package(s), ${regStatus.workspaces.length} workspace(s), but ${regStatus.staleCount} stale path(s) detected`,
        fix: "Run 'ac unlink --prune' to clean up stale entries from registry",
      });
    } else {
      checks.push({
        id: "registry.global",
        category: "registry",
        name: "Global Registry",
        status: "ok",
        message: `${regStatus.totalPackagesCount} linked package(s), ${regStatus.workspaces.length} workspace(s) (0 stale)`,
      });
    }
  } catch (err: any) {
    checks.push({
      id: "registry.global",
      category: "registry",
      name: "Global Registry",
      status: "error",
      message: `Failed to read registry: ${err.message}`,
    });
  }

  // 5. Check Project Context
  let projectRoot: string | null = null;
  if (options?.packageIdOrPath) {
    projectRoot = findProjectRoot(options.packageIdOrPath);
  } else {
    projectRoot = findProjectRoot(cwd);
  }

  let packageId: string | undefined;

  if (projectRoot) {
    try {
      const config = loadProjectConfig(projectRoot);
      packageId = config.id;

      // Project Config Check
      checks.push({
        id: "project.config",
        category: "project",
        name: "Project Configuration",
        status: "ok",
        message: `Valid (${config.id} v${config.version})`,
      });

      // SDK Resolution Check
      const hasSdkInNodeModules =
        existsSync(join(projectRoot, "node_modules", "@actiondock", "sdk")) ||
        existsSync(join(projectRoot, "node_modules", "@actiondock", "sdk", "package.json"));

      if (hasSdkInNodeModules) {
        checks.push({
          id: "project.sdk",
          category: "project",
          name: "SDK Dependency",
          status: "ok",
          message: "Resolved @actiondock/sdk in node_modules",
        });
      } else {
        checks.push({
          id: "project.sdk",
          category: "project",
          name: "SDK Dependency",
          status: "warn",
          message: "@actiondock/sdk not found in project node_modules",
          fix: "Run 'bun link @actiondock/sdk' or 'bun install' in project directory",
        });
      }

      // Project Runtime Database Check
      try {
        const projectStorage = createStorage(config.id, { projectRoot });
        await projectStorage.setConfig("_doctor_probe_", "ok");
        await projectStorage.deleteConfig("_doctor_probe_");
        projectStorage.close();

        checks.push({
          id: "project.storage",
          category: "project",
          name: "Project Database",
          status: "ok",
          message: `Database writable at ${join(projectRoot, ".actiondock", "runtime.db")}`,
        });
      } catch (err: any) {
        checks.push({
          id: "project.storage",
          category: "project",
          name: "Project Database",
          status: "error",
          message: `Failed to write project runtime database: ${err.message}`,
          fix: `Check write permissions for '${join(projectRoot, ".actiondock")}'`,
        });
      }

      // Actions Check
      try {
        const actions = await loadActions(projectRoot, config.actionsDir);
        if (actions.size === 0) {
          checks.push({
            id: "project.actions",
            category: "project",
            name: "Actions",
            status: "warn",
            message: `No actions found in '${config.actionsDir || "actions"}'`,
            fix: "Run 'ac action create <id>' to create your first action",
          });
        } else {
          checks.push({
            id: "project.actions",
            category: "project",
            name: "Actions",
            status: "ok",
            message: `${actions.size} action(s) valid and loaded`,
          });
        }
      } catch (err: any) {
        checks.push({
          id: "project.actions",
          category: "project",
          name: "Actions",
          status: "error",
          message: `Failed to load actions: ${err.message}`,
        });
      }

      // Playbooks Check
      try {
        const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);
        checks.push({
          id: "project.playbooks",
          category: "project",
          name: "Playbooks",
          status: "ok",
          message: `${playbooks.size} playbook(s) valid`,
        });
      } catch (err: any) {
        checks.push({
          id: "project.playbooks",
          category: "project",
          name: "Playbooks",
          status: "warn",
          message: `Playbooks issue: ${err.message}`,
        });
      }

      // Config readiness check
      if (config.config && Object.keys(config.config).length > 0) {
        const missingKeys: string[] = [];
        const projectStorage = createStorage(config.id, { projectRoot });
        for (const [key, def] of Object.entries(config.config)) {
          const inStorage = await projectStorage.getConfig(key);
          const envNames = Array.isArray(def.env) ? def.env : def.env ? [def.env] : [key];
          const inEnv = envNames.some((e) => process.env[e] !== undefined);
          const isRequired = (def as any).required || (def.default === undefined && def.secret);
          if ((isRequired || def.default === undefined) && inStorage === undefined && !inEnv) {
            missingKeys.push(key);
          }
        }
        projectStorage.close();

        if (missingKeys.length > 0) {
          checks.push({
            id: "project.config_readiness",
            category: "project",
            name: "Config Readiness",
            status: "warn",
            message: `Required config item(s) missing: ${missingKeys.join(", ")}`,
            fix: `Run 'ac config set <KEY> <VALUE>' to configure missing keys`,
          });
        } else {
          checks.push({
            id: "project.config_readiness",
            category: "project",
            name: "Config Readiness",
            status: "ok",
            message: "All declared configuration dependencies satisfied",
          });
        }
      }
    } catch (err: any) {
      checks.push({
        id: "project.config",
        category: "project",
        name: "Project Configuration",
        status: "error",
        message: `Invalid actiondock.json: ${err.message}`,
      });
    }
  }

  const okCount = checks.filter((c) => c.status === "ok").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const errorCount = checks.filter((c) => c.status === "error").length;

  return {
    ok: errorCount === 0,
    hasProject: !!projectRoot,
    projectRoot: projectRoot || undefined,
    packageId,
    summary: {
      total: checks.length,
      ok: okCount,
      warn: warnCount,
      error: errorCount,
    },
    checks,
  };
}
