import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, join, relative } from "node:path";
import type { ActionRef } from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { discoverActionFiles, findProjectRoot, loadActions, loadPlaybooks, loadProjectConfig } from "../project/loader";
import { loadManifest, MANIFEST_FILE_NAME } from "../project/manifest";
import { getRegistryStatus, listLinkedPackages, resolvePackageRoot } from "../registry/registry";
import { createGlobalStorage, createStorage } from "../storage";
import { findExecutable, getActionDockHome } from "../utils";
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

  // 1. Check Node.js Runtime
  const nodeVersion = process.versions.node;
  if (nodeVersion) {
    const isGte22 = compareSemver(nodeVersion, "22.12.0") >= 0;
    checks.push({
      id: "runtime.node",
      category: "runtime",
      name: "Node.js Runtime",
      status: isGte22 ? "ok" : "warn",
      message: `v${nodeVersion} (${isGte22 ? ">= 22.12.0 supported" : ">= 22.12.0 recommended"})`,
      fix: isGte22 ? undefined : "Upgrade Node.js to v22.12.0 or higher",
    });
  }

  // 2. Check Bun Runtime (Optional compiler for standalone binaries)
  const bunVersion = (typeof (globalThis as any).Bun !== "undefined" && (globalThis as any).Bun.version) || (process.versions as any).bun;
  if (bunVersion) {
    checks.push({
      id: "runtime.bun",
      category: "runtime",
      name: "Bun Runtime",
      status: "ok",
      message: `v${bunVersion} (available for standalone binary compilation)`,
    });
  } else {
    checks.push({
      id: "runtime.bun",
      category: "runtime",
      name: "Bun Runtime",
      status: "ok",
      message: "Bun compiler not detected (optional, required only for 'ad build' standalone binaries)",
    });
  }

  // 3. Check CLI in PATH
  const adPath = findExecutable("ad");

  if (adPath) {
    checks.push({
      id: "runtime.cli",
      category: "runtime",
      name: "CLI Executable",
      status: "ok",
      message: `Found 'ad' in PATH at ${adPath}`,
    });
  } else {
    checks.push({
      id: "runtime.cli",
      category: "runtime",
      name: "CLI Executable",
      status: "warn",
      message: "'ad' command not found in PATH",
      fix: "Run 'npm install -g @actiondock/cli' or in SDK workspace run 'cd packages/cli && npm link'",
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
      message: `Global SQLite database verified at ${globalHome}`,
    });
  } catch (err: any) {
    checks.push({
      id: "storage.global",
      category: "storage",
      name: "Global Storage",
      status: "error",
      message: `Failed to access global storage: ${err.message}`,
      fix: `Ensure directory '${globalHome}' is writable`,
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
        fix: "Run 'ad unlink --prune' to clean up stale entries from registry",
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

  // 5. Check Linked Package Dependencies (node_modules completeness)
  try {
    const linkedList = listLinkedPackages(options?.customHome);
    const missingNodeModules: string[] = [];

    for (const pkg of linkedList) {
      if (!existsSync(pkg.path)) continue;
      const pkgJsonPath = join(pkg.path, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        const hasDeps =
          (pkgJson.dependencies && Object.keys(pkgJson.dependencies).length > 0) ||
          (pkgJson.devDependencies && Object.keys(pkgJson.devDependencies).length > 0);
        if (hasDeps && !existsSync(join(pkg.path, "node_modules"))) {
          missingNodeModules.push(pkg.id);
        }
      } catch {
        // 忽略异常 JSON
      }
    }

    if (missingNodeModules.length > 0) {
      checks.push({
        id: "registry.dependencies",
        category: "registry",
        name: "Linked Package Dependencies",
        status: "warn",
        message: `${missingNodeModules.length} linked package(s) declare dependencies but miss node_modules: ${missingNodeModules.join(", ")}`,
        fix: "Run 'npm install' or 'bun install' in the affected package directories, or execute 'ad run' to auto-install",
      });
    } else {
      checks.push({
        id: "registry.dependencies",
        category: "registry",
        name: "Linked Package Dependencies",
        status: "ok",
        message: linkedList.length > 0
          ? "All linked packages have dependencies installed"
          : "No linked packages requiring dependency verification",
      });
    }
  } catch {
    // 忽略依赖检查异常
  }

  // 6. Check Cross-Package Uses Dependency Closure
  try {
    const linkedList = listLinkedPackages(options?.customHome);
    const packagesToCheck: Array<{ id: string; root: string }> = linkedList.map((p) => ({
      id: p.id,
      root: p.path,
    }));

    const curProjectRoot = options?.packageIdOrPath
      ? findProjectRoot(options.packageIdOrPath)
      : findProjectRoot(cwd);
    if (curProjectRoot && !packagesToCheck.some((p) => p.root === curProjectRoot)) {
      try {
        const cfg = loadProjectConfig(curProjectRoot);
        packagesToCheck.push({ id: cfg.id, root: curProjectRoot });
      } catch {
        // 忽略配置异常
      }
    }

    const unresolvableUses: string[] = [];

    for (const pkg of packagesToCheck) {
      if (!existsSync(pkg.root)) continue;
      const manifest = loadManifest(pkg.root);
      if (!manifest || !manifest.actions) continue;

      for (const [actionId, actionEntry] of Object.entries(manifest.actions)) {
        if (!Array.isArray(actionEntry.uses)) continue;
        for (const rawRef of actionEntry.uses) {
          if (typeof rawRef !== "string" || !rawRef.trim()) continue;
          let parsed: ActionRef;
          try {
            parsed = ActionResolver.parseRef(rawRef);
          } catch {
            unresolvableUses.push(`${pkg.id}/${actionId} -> '${rawRef}'`);
            continue;
          }

          if (parsed.packageId) {
            const depRoot = resolvePackageRoot(parsed.packageId, pkg.root, options?.customHome);
            if (!depRoot || !existsSync(depRoot)) {
              unresolvableUses.push(`${pkg.id}/${actionId} -> '${rawRef}'`);
            }
          }
        }
      }
    }

    if (unresolvableUses.length > 0) {
      checks.push({
        id: "registry.uses_closure",
        category: "registry",
        name: "Cross-Package Uses Dependencies",
        status: "warn",
        message: `${unresolvableUses.length} unresolvable cross-package dependency reference(s) found in manifest uses: ${unresolvableUses.join(", ")}`,
        fix: "Link missing packages with 'ad link', or correct unresolvable uses declarations",
      });
    } else {
      checks.push({
        id: "registry.uses_closure",
        category: "registry",
        name: "Cross-Package Uses Dependencies",
        status: "ok",
        message: "All cross-package uses declarations in manifests resolved successfully",
      });
    }
  } catch {
    // 忽略闭包检查异常
  }

  // 7. Check Project Context
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
        const manifest = loadManifest(projectRoot);
        let actionsCount = 0;
        if (manifest?.actions) {
          actionsCount = Object.keys(manifest.actions).length;
        } else {
          const actions = await loadActions(projectRoot, config.actionsDir, { autoInstall: false });
          actionsCount = actions.size;
        }

        if (actionsCount === 0) {
          checks.push({
            id: "project.actions",
            category: "project",
            name: "Actions",
            status: "warn",
            message: `No actions found in '${config.actionsDir || "actions"}'`,
            fix: "Run 'ad action new <id>' to create your first action",
          });
        } else {
          checks.push({
            id: "project.actions",
            category: "project",
            name: "Actions",
            status: "ok",
            message: `${actionsCount} action(s) valid and loaded`,
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

      // Project Manifest Check (Lightweight Static Detection)
      try {
        const manifestPath = join(projectRoot, MANIFEST_FILE_NAME);
        const manifest = loadManifest(projectRoot);
        const actionFiles = discoverActionFiles(projectRoot, config.actionsDir || "actions");

        if (!existsSync(manifestPath)) {
          if (actionFiles.length > 0) {
            checks.push({
              id: "project.manifest",
              category: "project",
              name: "Action Manifest",
              status: "warn",
              message: `${MANIFEST_FILE_NAME} not found (${actionFiles.length} action source file(s) exist)`,
              fix: "Run 'ad action sync' to generate manifest",
            });
          }
        } else if (manifest && manifest.actions) {
          const missingFiles = Object.entries(manifest.actions)
            .filter(([_, item]) => !existsSync(join(projectRoot, item.entry)))
            .map(([id, item]) => `${id} (${item.entry})`);

          const manifestEntries = new Set(
            Object.values(manifest.actions).map((a) => a.entry.replace(/\\/g, "/"))
          );
          const untracked = actionFiles
            .map((f) => relative(projectRoot, f).replace(/\\/g, "/"))
            .filter((rel) => !manifestEntries.has(rel));

          if (missingFiles.length > 0) {
            checks.push({
              id: "project.manifest",
              category: "project",
              name: "Action Manifest",
              status: "warn",
              message: `${missingFiles.length} action(s) in manifest point to missing files: ${missingFiles.join(", ")}`,
              fix: "Run 'ad action sync' to synchronize manifest",
            });
          } else if (untracked.length > 0) {
            checks.push({
              id: "project.manifest",
              category: "project",
              name: "Action Manifest",
              status: "warn",
              message: `${untracked.length} action file(s) not declared in manifest: ${untracked.join(", ")}`,
              fix: "Run 'ad action sync' to synchronize manifest",
            });
          } else {
            const manifestStat = statSync(manifestPath);
            const newerFiles = actionFiles.filter(
              (f) => statSync(f).mtimeMs > manifestStat.mtimeMs + 2000
            );
            if (newerFiles.length > 0) {
              checks.push({
                id: "project.manifest",
                category: "project",
                name: "Action Manifest",
                status: "ok",
                message: `Manifest valid (Note: ${newerFiles.length} action file(s) modified after manifest; run 'ad action sync' if definitions changed)`,
              });
            } else {
              checks.push({
                id: "project.manifest",
                category: "project",
                name: "Action Manifest",
                status: "ok",
                message: "Manifest synchronized with action files",
              });
            }
          }
        }
      } catch (err: any) {
        checks.push({
          id: "project.manifest",
          category: "project",
          name: "Action Manifest",
          status: "error",
          message: `Failed to inspect manifest: ${err.message}`,
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
            fix: `Run 'ad config set <KEY> <VALUE>' to configure missing keys`,
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
