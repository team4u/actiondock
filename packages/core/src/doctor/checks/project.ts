import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { discoverActionFiles, loadActions, loadPlaybooks, loadProjectConfig } from "../../project/loader";
import { loadManifest, MANIFEST_FILE_NAME } from "../../project/manifest";
import type { ProjectConfig } from "../../project/types";
import { createStorage, resolveDatabasePath } from "../../storage";
import type { DoctorCheck, DoctorCheckContext } from "../context";

/**
 * 工程级诊断的共享参数：定位后的工程根目录与已加载的工程配置。
 */
interface ProjectCheckScope {
  ctx: DoctorCheckContext;
  projectRoot: string;
  config: ProjectConfig;
}

/**
 * 检查工程配置可解析性，并写入 ctx.packageId 供报告汇总使用。
 */
function checkProjectConfig(scope: ProjectCheckScope): void {
  const { ctx, config } = scope;
  ctx.packageId = config.id;

  ctx.checks.push({
    id: "project.config",
    category: "project",
    name: "Project Configuration",
    status: "ok",
    message: `Valid (${config.id} v${config.version})`,
  });
}

/**
 * 检查工程 node_modules 中 @actiondock/sdk 的可解析性。
 */
function checkProjectSdk(scope: ProjectCheckScope): void {
  const { ctx, projectRoot } = scope;

  const hasSdkInNodeModules =
    existsSync(join(projectRoot, "node_modules", "@actiondock", "sdk")) ||
    existsSync(join(projectRoot, "node_modules", "@actiondock", "sdk", "package.json"));

  if (hasSdkInNodeModules) {
    ctx.checks.push({
      id: "project.sdk",
      category: "project",
      name: "SDK Dependency",
      status: "ok",
      message: "Resolved @actiondock/sdk in node_modules",
    });
  } else {
    ctx.checks.push({
      id: "project.sdk",
      category: "project",
      name: "SDK Dependency",
      status: "warn",
      message: "@actiondock/sdk not found in project node_modules",
      fix: "Run 'npm link @actiondock/sdk' or 'npm install' in project directory",
    });
  }
}

/**
 * 检查工程运行时数据库可写性。
 */
async function checkProjectStorage(scope: ProjectCheckScope): Promise<void> {
  const { ctx, config } = scope;

  const dbPath = resolveDatabasePath(config.id, { customHome: ctx.customHome });
  try {
    const projectStorage = createStorage(config.id, { customHome: ctx.customHome });
    await projectStorage.setConfig("_doctor_probe_", "ok");
    await projectStorage.deleteConfig("_doctor_probe_");
    projectStorage.close();

    ctx.checks.push({
      id: "project.storage",
      category: "project",
      name: "Project Database",
      status: "ok",
      message: `Database writable at ${dbPath}`,
    });
  } catch (err: any) {
    ctx.checks.push({
      id: "project.storage",
      category: "project",
      name: "Project Database",
      status: "error",
      message: `Failed to write project runtime database: ${err.message}`,
      fix: `Check write permissions for '${dirname(dbPath)}'`,
    });
  }
}

/**
 * 检查工程 Actions 可加载性与数量。
 */
async function checkProjectActions(scope: ProjectCheckScope): Promise<void> {
  const { ctx, projectRoot, config } = scope;

  try {
    const manifest = loadManifest(projectRoot);
    let actionsCount = 0;
    if (manifest?.actions) {
      actionsCount = Object.keys(manifest.actions).length;
    } else {
      const actions = await loadActions(projectRoot, config.actionsDir);
      actionsCount = actions.size;
    }

    if (actionsCount === 0) {
      ctx.checks.push({
        id: "project.actions",
        category: "project",
        name: "Actions",
        status: "warn",
        message: `No actions found in '${config.actionsDir || "actions"}'`,
        fix: "Run 'ad action new <id>' to create your first action",
      });
    } else {
      ctx.checks.push({
        id: "project.actions",
        category: "project",
        name: "Actions",
        status: "ok",
        message: `${actionsCount} action(s) valid and loaded`,
      });
    }
  } catch (err: any) {
    ctx.checks.push({
      id: "project.actions",
      category: "project",
      name: "Actions",
      status: "error",
      message: `Failed to load actions: ${err.message}`,
    });
  }
}

/**
 * 检查 Action 清单与源码文件的双向一致性（轻量静态检测）。
 */
function checkProjectManifest(scope: ProjectCheckScope): void {
  const { ctx, projectRoot, config } = scope;

  try {
    const manifestPath = join(projectRoot, MANIFEST_FILE_NAME);
    const manifest = loadManifest(projectRoot);
    const actionFiles = discoverActionFiles(projectRoot, config.actionsDir || "actions");

    if (!existsSync(manifestPath)) {
      if (actionFiles.length > 0) {
        ctx.checks.push({
          id: "project.manifest",
          category: "project",
          name: "Action Manifest",
          status: "warn",
          message: `${MANIFEST_FILE_NAME} not found (${actionFiles.length} action source file(s) exist)`,
          fix: "Run 'ad validate' to generate or check manifest",
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
        ctx.checks.push({
          id: "project.manifest",
          category: "project",
          name: "Action Manifest",
          status: "warn",
          message: `${missingFiles.length} action(s) in manifest point to missing files: ${missingFiles.join(", ")}`,
          fix: "Run 'ad validate' to check or update actiondock.json",
        });
      } else if (untracked.length > 0) {
        ctx.checks.push({
          id: "project.manifest",
          category: "project",
          name: "Action Manifest",
          status: "warn",
          message: `${untracked.length} action file(s) not declared in manifest: ${untracked.join(", ")}`,
          fix: "Run 'ad validate' to check or update actiondock.json",
        });
      } else {
        const manifestStat = statSync(manifestPath);
        const newerFiles = actionFiles.filter(
          (f) => statSync(f).mtimeMs > manifestStat.mtimeMs + 2000
        );
        if (newerFiles.length > 0) {
          ctx.checks.push({
            id: "project.manifest",
            category: "project",
            name: "Action Manifest",
            status: "ok",
            message: `Manifest valid (Note: ${newerFiles.length} action file(s) modified after manifest; run 'ad validate' if definitions changed)`,
          });
        } else {
          ctx.checks.push({
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
    ctx.checks.push({
      id: "project.manifest",
      category: "project",
      name: "Action Manifest",
      status: "error",
      message: `Failed to inspect manifest: ${err.message}`,
    });
  }
}

/**
 * 检查 files 声明边界与源码目录未声明引用。
 */
function checkProjectFiles(scope: ProjectCheckScope): void {
  const { ctx, projectRoot, config } = scope;

  try {
    const declaredFiles = config.files || [];
    const hasSrc = existsSync(join(projectRoot, "src"));
    const hasLib = existsSync(join(projectRoot, "lib"));

    if (declaredFiles.length > 0) {
      const missingDeclared = declaredFiles.filter((f) => !existsSync(join(projectRoot, f)));
      if (missingDeclared.length > 0) {
        ctx.checks.push({
          id: "project.files",
          category: "project",
          name: "Declared Files",
          status: "error",
          message: `${missingDeclared.length} path(s) declared in 'files' do not exist: ${missingDeclared.join(", ")}`,
          fix: `Verify and update 'files' in ${MANIFEST_FILE_NAME}`,
        });
      } else {
        ctx.checks.push({
          id: "project.files",
          category: "project",
          name: "Declared Files",
          status: "ok",
          message: `All ${declaredFiles.length} declared file/directory boundaries verified`,
        });
      }
    } else if (hasSrc || hasLib) {
      const actionFiles = discoverActionFiles(projectRoot, config.actionsDir || "actions");
      let hasReferenceToSrcOrLib = false;
      const unreadableFiles: string[] = [];
      for (const actFile of actionFiles) {
        try {
          const src = readFileSync(actFile, "utf-8");
          if (/['"](?:\.\.\/(?:src|lib)|\.\/(?:src|lib))[^'"]*['"]/.test(src)) {
            hasReferenceToSrcOrLib = true;
            break;
          }
        } catch (err: any) {
          // 单文件读取失败：计入告警名单，边界检测结论不再基于无声缺失的数据
          unreadableFiles.push(`${actFile} (${err?.message || String(err)})`);
        }
      }

      if (hasReferenceToSrcOrLib) {
        ctx.checks.push({
          id: "project.files",
          category: "project",
          name: "Declared Files",
          status: "error",
          message: `Actions import modules from ${hasSrc ? "'src/'" : ""}${hasSrc && hasLib ? " and " : ""}${hasLib ? "'lib/'" : ""}, but 'files' is not declared in ${MANIFEST_FILE_NAME}`,
          fix: `Add "files": [${hasSrc ? '"src"' : ""}${hasSrc && hasLib ? ', "lib"' : hasLib && !hasSrc ? '"lib"' : ""}] to ${MANIFEST_FILE_NAME}`,
        });
      } else {
        ctx.checks.push({
          id: "project.files",
          category: "project",
          name: "Declared Files",
          status: unreadableFiles.length > 0 ? "warn" : "ok",
          message:
            unreadableFiles.length > 0
              ? `Project source directories clean, but ${unreadableFiles.length} action file(s) unreadable during boundary scan: ${unreadableFiles.join(", ")}`
              : `Project source directories clean (no undeclared references to ${hasSrc ? "src/" : "lib/"})`,
        });
      }
    }
  } catch (err: any) {
    // 文件边界检测整体失败：转为 error 检查项呈现在报告中，而非无声跳过
    ctx.checks.push({
      id: "project.files",
      category: "project",
      name: "Declared Files",
      status: "error",
      message: `Failed to inspect declared files and source boundaries: ${err?.message || String(err)}`,
    });
  }
}

/**
 * 检查工程 Playbook 规程文档可加载性。
 */
function checkProjectPlaybooks(scope: ProjectCheckScope): void {
  const { ctx, projectRoot, config } = scope;

  try {
    const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);
    ctx.checks.push({
      id: "project.playbooks",
      category: "project",
      name: "Playbooks",
      status: "ok",
      message: `${playbooks.size} playbook(s) valid`,
    });
  } catch (err: any) {
    ctx.checks.push({
      id: "project.playbooks",
      category: "project",
      name: "Playbooks",
      status: "warn",
      message: `Playbooks issue: ${err.message}`,
    });
  }
}

/**
 * 检查声明配置项的就绪状态（存储值 / 环境变量 / 默认值兜底）。
 */
async function checkProjectConfigReadiness(scope: ProjectCheckScope): Promise<void> {
  const { ctx, config } = scope;

  if (config.config && Object.keys(config.config).length > 0) {
    const missingKeys: string[] = [];
    const projectStorage = createStorage(config.id, { customHome: ctx.customHome });
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
      ctx.checks.push({
        id: "project.config_readiness",
        category: "project",
        name: "Config Readiness",
        status: "warn",
        message: `Required config item(s) missing: ${missingKeys.join(", ")}`,
        fix: `Run 'ad config set <KEY> <VALUE>' to configure missing keys`,
      });
    } else {
      ctx.checks.push({
        id: "project.config_readiness",
        category: "project",
        name: "Config Readiness",
        status: "ok",
        message: "All declared configuration dependencies satisfied",
      });
    }
  }
}

/**
 * 工程级诊断入口：加载工程配置后按序执行全部工程检查；
 * 配置损坏时转为 project.config error 检查项（此时 packageId 已就绪的值保持不回滚）。
 */
export const checkProject: DoctorCheck = {
  id: "project.detail",
  run: async (ctx) => {
    const projectRoot = ctx.projectRoot;
    if (!projectRoot) return;

    try {
      const config = loadProjectConfig(projectRoot);
      const scope: ProjectCheckScope = { ctx, projectRoot, config };

      checkProjectConfig(scope);
      checkProjectSdk(scope);
      await checkProjectStorage(scope);
      await checkProjectActions(scope);
      checkProjectManifest(scope);
      checkProjectFiles(scope);
      checkProjectPlaybooks(scope);
      await checkProjectConfigReadiness(scope);
    } catch (err: any) {
      ctx.checks.push({
        id: "project.config",
        category: "project",
        name: "Project Configuration",
        status: "error",
        message: `Invalid actiondock.json: ${err.message}`,
      });
    }
  },
};
