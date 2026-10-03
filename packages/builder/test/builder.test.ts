import { runCommandSync } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { Readable, Writable } from "node:stream";
import { createGzip } from "node:zlib";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  initProject,
} from "@actiondock/core";
import {
  linkPackage,
} from "@actiondock/core/registry";
import {
  type ActionDockManifest,
  ACTION_ID_REGEX,
  loadActions,
  saveManifest,
} from "@actiondock/core/project";
import {
  buildProject,
  packProject,
  BuilderError,
  PlannerError,
  exportSkill,
  exportCompositeSkill,
  SelectionPlanner,
} from "../src";
import {
  assertValidManifestActionIds,
  serializePlanManifest,
} from "../src/manifest";
import {
  collectRelativeFiles,
  getInternalDependencyVersion,
  replaceDirAtomic,
  moveDirAtomic,
} from "../src/fs-utils";
import {
  createTarGzArchiveAsync,
  createZipArchiveAsync,
  dosDateTime,
  writeToStream,
} from "../src/archive";
import {
  readTarGzEntries,
  readTarGzEntryModes,
  readZipEntries,
  readZipEntryModes,
} from "./archive-reader";

/** 捕获 console.warn 输出：返回回调执行结果与捕获的警告文本 */
async function captureConsoleWarn<T>(fn: () => Promise<T>): Promise<{ output: string; result: T }> {
  const chunks: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  try {
    const result = await fn();
    return { output: chunks.join("\n"), result };
  } finally {
    console.warn = originalWarn;
  }
}

/** 递归收集目录内文件：归档内相对路径（含根目录前缀）→ 文件内容 */
function collectFiles(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const root = basename(dir);
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const fullPath = join(current, name);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else {
        const relPath = relative(dir, fullPath).split(sep).join("/");
        files.set(`${root}/${relPath}`, readFileSync(fullPath));
      }
    }
  };
  walk(dir);
  return files;
}

const deferredCleanupDirs = new Set<string>();

/** 快速非阻塞清理目录，遇到 Windows 短暂句柄占用时安全捕获并推迟回收，杜绝用例生命周期中的阻塞延迟 */
function safeCleanDir(targetDir?: string): void {
  if (!targetDir || !existsSync(targetDir)) return;
  try {
    rmSync(targetDir, { recursive: true, force: true, maxRetries: 1, retryDelay: 10 });
  } catch {
    deferredCleanupDirs.add(targetDir);
  }
}

function flushDeferredCleanup(): void {
  for (const dir of deferredCleanupDirs) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 1, retryDelay: 10 });
      } catch {}
    }
  }
  deferredCleanupDirs.clear();
}

describe("@actiondock/builder 测试套件", () => {
  let suiteBaseDir: string;
  let tempDir: string;
  let tempHome: string;
  let caseIndex = 0;

  before(() => {
    suiteBaseDir = mkdtempSync(join(tmpdir(), "ad-builder-suite-"));
    tempHome = join(suiteBaseDir, "home");
    mkdirSync(tempHome, { recursive: true });
  });

  after(() => {
    safeCleanDir(suiteBaseDir);
    flushDeferredCleanup();
  });

  beforeEach(() => {
    caseIndex++;
    tempDir = join(suiteBaseDir, `case-${caseIndex}`);
    mkdirSync(tempDir, { recursive: true });

    // 软链接根 node_modules 保证测试期间依赖解析
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }

    // 初始化基础项目结构
    initProject(tempDir, {
      id: "test.builder-fixture",
      name: "Builder Fixture Package",
      description: "Test fixture for builder test suite",
    });
  });

  afterEach(() => {
    safeCleanDir(tempDir);
  });

  describe("SelectionPlanner: 依赖闭包计算与构建规划", () => {
    it("基于声明式清单规划构建并正确区分三类依赖", () => {
      // 写入声明式清单
      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "sample.greet": {
            entry: "actions/greet.ts",
            description: "Greet action",
            uses: [],
          },
        },
        assets: ["assets/template.txt"],
      };
      saveManifest(tempDir, manifest);

      // 创建资产文件
      mkdirSync(join(tempDir, "assets"), { recursive: true });
      writeFileSync(join(tempDir, "assets", "template.txt"), "Hello Template", "utf-8");

      const planner = new SelectionPlanner({ projectRoot: tempDir });
      const plan = planner.plan();

      assert.strictEqual(plan.packageId, "test.builder-fixture");
      assert.strictEqual(plan.actions.length, 1);
      assert.strictEqual(plan.actions[0].id, "sample.greet");

      // 验证依赖分类
      assert.strictEqual(plan.dependencies.actions.length, 1);
      assert.strictEqual(plan.dependencies.actions[0].id, "sample.greet");
      assert.strictEqual(plan.dependencies.actions[0].resolvedPath, join(tempDir, "actions", "greet.ts"));

      // 验证模块与资产依赖
      const assetDeps = plan.dependencies.modulesAndAssets;
      assert.strictEqual(assetDeps.some((a) => a.path === "assets/template.txt" && a.type === "asset"), true);
      assert.strictEqual(assetDeps.some((a) => a.path === "actiondock.json" && a.type === "config"), true);

      // 验证外部依赖解析
      assert.strictEqual(Array.isArray(plan.dependencies.external), true);
      assert.strictEqual(plan.dependencies.external.some((d) => d.name === "@actiondock/sdk"), true);
    });

    it("绝不执行 Action 业务代码", () => {
      // 写入在加载阶段若被 import 即刻爆炸的 Action 源码
      const bombActionCode = `
// 若被 import() 或 eval() 则直接抛错
throw new Error("ILLEGAL_CODE_EXECUTION: Action business code must NOT be executed during planning!");

export default {
  id: "sample.bomb",
  run: async () => ({ status: "never" }),
};
`;
      writeFileSync(join(tempDir, "actions", "bomb.ts"), bombActionCode, "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "sample.bomb": {
            entry: "actions/bomb.ts",
            description: "Bomb action",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      // 执行规划：应当成功返回，绝不得触发上述异常
      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
        actions: ["sample.bomb"],
      });

      assert.strictEqual(plan.actions.length, 1);
      assert.strictEqual(plan.actions[0].id, "sample.bomb");
    });

    it("正确解析多级传递依赖闭包（A -> B -> C）并排除无关 Action", () => {
      // 创建关联 Action 文件
      writeFileSync(join(tempDir, "actions", "a.ts"), "export default {};", "utf-8");
      writeFileSync(join(tempDir, "actions", "b.ts"), "export default {};", "utf-8");
      writeFileSync(join(tempDir, "actions", "c.ts"), "export default {};", "utf-8");
      writeFileSync(join(tempDir, "actions", "isolated.ts"), "export default {};", "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "action.a": {
            entry: "actions/a.ts",
            description: "Action A",
            uses: ["action.b"],
          },
          "action.b": {
            entry: "actions/b.ts",
            description: "Action B",
            uses: ["action.c"],
          },
          "action.c": {
            entry: "actions/c.ts",
            description: "Action C",
            uses: [],
          },
          "action.isolated": {
            entry: "actions/isolated.ts",
            description: "Isolated Action",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      // 仅挑选 action.a
      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
        actions: ["action.a"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      assert.ok((actionIds).includes("action.a"));
      assert.ok((actionIds).includes("action.b"));
      assert.ok((actionIds).includes("action.c"));
      assert.ok(!(actionIds).includes("action.isolated"));
      assert.strictEqual(plan.actions.length, 3);
    });

    it("菱形依赖下闭包不重复解析：高入度节点只入队一次且结果集无重复", () => {
      // 菱形拓扑：top -> left -> bottom、top -> right -> bottom，bottom 为高入度节点
      for (const name of ["top", "left", "right", "bottom"]) {
        writeFileSync(join(tempDir, "actions", `${name}.ts`), "export default {};", "utf-8");
      }

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "action.top": {
            entry: "actions/top.ts",
            description: "Action Top",
            uses: ["action.left", "action.right"],
          },
          "action.left": {
            entry: "actions/left.ts",
            description: "Action Left",
            uses: ["action.bottom"],
          },
          "action.right": {
            entry: "actions/right.ts",
            description: "Action Right",
            uses: ["action.bottom"],
          },
          "action.bottom": {
            entry: "actions/bottom.ts",
            description: "Action Bottom",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
        actions: ["action.top"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      // 结果集恰好包含四个节点，无重复条目
      assert.strictEqual(actionIds.length, 4);
      assert.strictEqual(new Set(actionIds).size, 4);
      for (const expected of ["action.top", "action.left", "action.right", "action.bottom"]) {
        assert.ok((actionIds).includes(expected));
      }
    });

    it("高入度菱形依赖下闭包队列不重复膨胀：多扇入节点只解析一次", () => {
      // 构造星形+菱形混合拓扑：多个上游同时引用同一批下游，验证去重解析
      for (const name of ["hub-a", "hub-b", "hub-c", "shared-x", "shared-y"]) {
        writeFileSync(join(tempDir, "actions", `${name}.ts`), "export default {};", "utf-8");
      }

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "hub.a": {
            entry: "actions/hub-a.ts",
            description: "Hub A",
            uses: ["shared.x", "shared.y"],
          },
          "hub.b": {
            entry: "actions/hub-b.ts",
            description: "Hub B",
            uses: ["shared.x", "shared.y"],
          },
          "hub.c": {
            entry: "actions/hub-c.ts",
            description: "Hub C",
            uses: ["shared.x", "shared.y"],
          },
          "shared.x": {
            entry: "actions/shared-x.ts",
            description: "Shared X",
            uses: [],
          },
          "shared.y": {
            entry: "actions/shared-y.ts",
            description: "Shared Y",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
        actions: ["hub.a", "hub.b", "hub.c"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      assert.strictEqual(actionIds.length, 5);
      assert.strictEqual(new Set(actionIds).size, 5);
    });

    it("支持环形依赖（A -> B -> A）安全终止并包含闭包中的所有节点", () => {
      writeFileSync(join(tempDir, "actions", "loop-a.ts"), "export default {};", "utf-8");
      writeFileSync(join(tempDir, "actions", "loop-b.ts"), "export default {};", "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "loop.a": {
            entry: "actions/loop-a.ts",
            description: "Loop A",
            uses: ["loop.b"],
          },
          "loop.b": {
            entry: "actions/loop-b.ts",
            description: "Loop B",
            uses: ["loop.a"],
          },
        },
      };
      saveManifest(tempDir, manifest);

      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
        actions: ["loop.a"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      assert.ok((actionIds).includes("loop.a"));
      assert.ok((actionIds).includes("loop.b"));
      assert.strictEqual(plan.actions.length, 2);
    });

    it("支持按 Playbook 进行依赖闭包裁剪计算", () => {
      writeFileSync(join(tempDir, "actions", "task-main.ts"), "export default {};", "utf-8");
      writeFileSync(join(tempDir, "actions", "task-helper.ts"), "export default {};", "utf-8");
      writeFileSync(join(tempDir, "actions", "task-other.ts"), "export default {};", "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "task.main": {
            entry: "actions/task-main.ts",
            description: "Main task",
            uses: ["task.helper"],
          },
          "task.helper": {
            entry: "actions/task-helper.ts",
            description: "Helper task",
            uses: [],
          },
          "task.other": {
            entry: "actions/task-other.ts",
            description: "Other task",
            uses: [],
          },
        },
        playbooks: {
          "workflow-main": {
            entry: "playbooks/workflow-main.md",
            description: "Main workflow SOP",
            actions: ["task.main"],
          },
          "workflow-other": {
            entry: "playbooks/workflow-other.md",
            description: "Other workflow SOP",
            actions: ["task.other"],
          },
        },
      };
      saveManifest(tempDir, manifest);

      // 创建两份纯 Markdown 规程文档
      const pb1Content = `# Main Workflow\n`;
      const pb2Content = `# Other Workflow\n`;
      writeFileSync(join(tempDir, "playbooks", "workflow-main.md"), pb1Content, "utf-8");
      writeFileSync(join(tempDir, "playbooks", "workflow-other.md"), pb2Content, "utf-8");

      // 仅挑选 workflow-main 规程
      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
        playbooks: ["workflow-main"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      assert.ok((actionIds).includes("task.main"));
      assert.ok((actionIds).includes("task.helper"));
      assert.ok(!(actionIds).includes("task.other"));
      assert.strictEqual(plan.actions.length, 2);

      const pbIds = plan.playbooks.map((p) => p.id);
      assert.deepStrictEqual(pbIds, ["workflow-main"]);
    });

    it("当依赖闭包中引用的下游 Action 不存在时报错", () => {
      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "broken.action": {
            entry: "actions/greet.ts",
            description: "Broken action",
            uses: ["missing.dependency"],
          },
        },
      };
      saveManifest(tempDir, manifest);

      assert.throws(() => {
        SelectionPlanner.plan({
          projectRoot: tempDir,
          actions: ["broken.action"],
        });
      }, /missing\.dependency/);
    });

    it("通过 actiondock.json 或构建参数中的 files 声明收集模块文件，杜绝未声明导入猜测与 AST 扫描", () => {
      // 创建 lib 源码目录与辅助文件
      mkdirSync(join(tempDir, "lib", "utils"), { recursive: true });
      writeFileSync(join(tempDir, "lib", "utils", "sanitize.ts"), "export const sanitize = (s: string) => s.trim();", "utf-8");
      writeFileSync(
        join(tempDir, "lib", "format.ts"),
        'export const format = (s: string) => s.toUpperCase();',
        "utf-8"
      );
      // 未声明的额外文件
      writeFileSync(join(tempDir, "lib", "unused.ts"), "export const unused = 42;", "utf-8");

      const actionCode = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "sample.custom-greet",
  description: "Greet action",
  run: async () => ("hello"),
});
`;
      writeFileSync(join(tempDir, "actions", "custom-greet.ts"), actionCode, "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "sample.custom-greet": {
            entry: "actions/custom-greet.ts",
            description: "Greet action",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      // 1. 显式构建参数 files 仅指定部分文件，未声明的 unused.ts 绝不猜测纳入
      const selectivePlan = SelectionPlanner.plan({
        projectRoot: tempDir,
        actions: ["sample.custom-greet"],
        files: ["lib/format.ts", "lib/utils/sanitize.ts"],
      });

      const selectiveModules = selectivePlan.dependencies.modulesAndAssets.filter((d) => d.type === "module");
      const selectivePaths = selectiveModules.map((m) => m.path.replace(/\\/g, "/"));
      assert.ok((selectivePaths).includes("lib/format.ts"));
      assert.ok((selectivePaths).includes("lib/utils/sanitize.ts"));
      assert.ok(!(selectivePaths).includes("lib/unused.ts"));

      // 2. actiondock.json 声明 files 为目录，目录内有效文件全部收集
      const configPath = join(tempDir, "actiondock.json");
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      cfg.files = ["lib"];
      writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8");

      const dirPlan = SelectionPlanner.plan({
        projectRoot: tempDir,
      });

      const dirModules = dirPlan.dependencies.modulesAndAssets.filter((d) => d.type === "module");
      const dirPaths = dirModules.map((m) => m.path.replace(/\\/g, "/"));
      assert.ok((dirPaths).includes("lib/format.ts"));
      assert.ok((dirPaths).includes("lib/utils/sanitize.ts"));
      assert.ok((dirPaths).includes("lib/unused.ts"));
    });

    it("支持锁文件探测、SHA-256 摘要计算及指纹一致性校验", () => {
      const lockContent = JSON.stringify({ name: "test", lockfileVersion: 3 });
      writeFileSync(join(tempDir, "package-lock.json"), lockContent, "utf-8");

      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
      });

      assert.notStrictEqual(plan.lockfile, undefined);
      assert.strictEqual(plan.lockfile?.name, "package-lock.json");
      assert.ok(/^[a-f0-9]{64}$/.test(plan.lockfile?.sha256));
      assert.strictEqual(plan.metadata.lockfileDigest, plan.lockfile?.sha256);

      // 验证校验失败场景：期望摘要不匹配抛错
      assert.throws(() => {
        SelectionPlanner.plan({
          projectRoot: tempDir,
          expectedLockfileDigest: "invalid-digest-value",
        });
      }, /Lockfile digest mismatch/);
    });

    it("支持跨包 actiondock.json 声明传递依赖闭包的递归展开", async () => {
      const extDir = mkdtempSync(join(tmpdir(), "ad-dep-closure-"));
      try {
        initProject(extDir, {
          id: "test.closure-dep",
          name: "Closure Dep",
        });
        writeFileSync(
          join(extDir, "actions", "dep-action.ts"),
          `export default { id: "dep-action", run: () => "ok" };`
        );
        const extConfigPath = join(extDir, "actiondock.json");
        const extCfg = JSON.parse(readFileSync(extConfigPath, "utf-8"));
        extCfg.actions = {
          "dep-action": {
            entry: "actions/dep-action.ts",
            uses: [],
          },
        };
        writeFileSync(extConfigPath, JSON.stringify(extCfg, null, 2), "utf-8");
        await linkPackage(extDir);

        const manifest: ActionDockManifest = {
          schemaVersion: 1,
          id: "test.builder-fixture",
          actions: {
            "root.caller": {
              entry: "actions/greet.ts",
              description: "Root caller action",
              uses: ["test.closure-dep/dep-action"],
            },
          },
        };
        saveManifest(tempDir, manifest);

        const plan = SelectionPlanner.plan({
          projectRoot: tempDir,
          actions: ["root.caller"],
        });

        const actionIds = plan.actions.map((a) => a.id);
        assert.ok((actionIds).includes("root.caller"));
        assert.ok((actionIds).includes("test.closure-dep/dep-action"));
      } finally {
        safeCleanDir(extDir);
      }
    });

    it("walkDirectory 扫描 assets 时忽略跳过指向项目根目录外部的软链接", () => {
      // 内部资产目录与内部资产
      const assetsDir = join(tempDir, "assets");
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(join(assetsDir, "local-asset.txt"), "local asset content", "utf-8");

      // 项目外部的真实文件并软链接到 assets 目录中
      const externalDir = mkdtempSync(join(tmpdir(), "ad-external-"));
      const externalFile = join(externalDir, "secret.txt");
      writeFileSync(externalFile, "sensitive data", "utf-8");

      try {
        symlinkSync(externalFile, join(assetsDir, "escaped-link.txt"));

        // 构建全量构建计划
        const plan = SelectionPlanner.plan({ projectRoot: tempDir });

        const assetDeps = plan.dependencies.modulesAndAssets.filter((d) => d.type === "asset");
        const assetPaths = assetDeps.map((d) => d.path.replace(/\\/g, "/"));

        // 内部资产应被纳入
        assert.ok((assetPaths).includes("assets/local-asset.txt"));
        // 逃逸外部的软链接应被忽略并跳过
        assert.ok(!(assetPaths).includes("assets/escaped-link.txt"));
      } finally {
        safeCleanDir(externalDir);
      }
    });
  });

  describe("buildProject: Node.js 目录型交付产物生成", () => {
    it("成功构建 Node.js 目录交付产物并生成可执行启动入口与元数据", async () => {
      const buildRes = await buildProject({
        projectRoot: tempDir,
      });

      assert.strictEqual(existsSync(buildRes.outputDir), true);
      assert.strictEqual(existsSync(buildRes.entrypointPath), true);
      assert.strictEqual(existsSync(buildRes.metadataPath), true);
      assert.strictEqual(existsSync(join(buildRes.outputDir, "actiondock.json")), true);
      assert.strictEqual(existsSync(join(buildRes.outputDir, "actiondock.manifest.json")), false);
      assert.strictEqual(existsSync(join(buildRes.outputDir, "package.json")), true);
      assert.strictEqual(buildRes.reproducible, true);

      const metadata = JSON.parse(readFileSync(buildRes.metadataPath, "utf-8"));
      assert.strictEqual(metadata.packageId, "test.builder-fixture");
      assert.deepStrictEqual(metadata.actions, ["sample.greet"]);

      // 执行生成的启动入口测试 list 与 describe
      const listProc = runCommandSync([buildRes.entrypointPath, "list", "--json"], {
        cwd: tempDir,
        env: {
          ...process.env,
          ACTIONDOCK_HOME: tempHome,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      if (listProc.exitCode !== 0) {
        throw new Error(
          `listProc failed with exitCode ${listProc.exitCode}\nSTDOUT: ${listProc.stdout.toString()}\nSTDERR: ${listProc.stderr.toString()}`
        );
      }
      assert.strictEqual(listProc.exitCode, 0);
      const listJson = JSON.parse(listProc.stdout.toString());
      assert.strictEqual(listJson.items.length, 1);
      assert.strictEqual(listJson.items[0].id, "sample.greet");
    });

    it("支持 options.archive 生成标准 zip 压缩归档交付产物", async () => {
      const buildRes = await buildProject({
        projectRoot: tempDir,
        archive: true,
      });

      assert.notStrictEqual(buildRes.archivePath, undefined);
      assert.strictEqual(existsSync(buildRes.archivePath!), true);
      assert.strictEqual(buildRes.archivePath!.endsWith(".zip"), true);
      const stat = statSync(buildRes.archivePath!);
      assert.ok((stat.size) > 0);
    });

    it("支持 options.vendorDeps 在干净暂存目录中物化依赖", async () => {
      const buildRes = await buildProject({
        projectRoot: tempDir,
        vendorDeps: true,
      });

      assert.strictEqual(buildRes.vendorDeps, true);
      assert.strictEqual(existsSync(join(buildRes.outputDir, "node_modules")), true);
    });

    it("含外部链接依赖的项目构建产物不混入外部包 entry 源文件", async () => {
      const extDir = mkdtempSync(join(tmpdir(), "ad-ext-entry-test-"));
      try {
        initProject(extDir, { id: "test.ext-entry", name: "External Entry" });
        writeFileSync(
          join(extDir, "actions", "calc.ts"),
          `export default { id: "calc", run: () => 42 };`
        );
        const extCfgPath = join(extDir, "actiondock.json");
        const extCfg = JSON.parse(readFileSync(extCfgPath, "utf-8"));
        extCfg.actions = {
          calc: { entry: "actions/calc.ts", description: "Calc action", uses: [] },
        };
        writeFileSync(extCfgPath, JSON.stringify(extCfg, null, 2), "utf-8");
        await linkPackage(extDir);

        const mainManifestPath = join(tempDir, "actiondock.json");
        const mainManifest = JSON.parse(readFileSync(mainManifestPath, "utf-8"));
        mainManifest.actions["sample.greet"].uses = ["test.ext-entry/calc"];
        writeFileSync(mainManifestPath, JSON.stringify(mainManifest, null, 2), "utf-8");

        const buildRes = await buildProject({
          projectRoot: tempDir,
          skipDependencyValidation: true,
        });

        // 本包 entry 正常物化
        assert.strictEqual(existsSync(join(buildRes.outputDir, "actions", "greet.ts")), true);
        // 外部包 entry 绝不物化进本包产物目录（与清单剔除策略一致）
        assert.strictEqual(existsSync(join(buildRes.outputDir, "actions", "calc.ts")), false);

        // 生成的 actiondock.json 清单不包含跨包外部 Action
        const outputManifest = JSON.parse(
          readFileSync(join(buildRes.outputDir, "actiondock.json"), "utf-8")
        );
        assert.deepStrictEqual(Object.keys(outputManifest.actions), ["sample.greet"]);

        // host 入口脚本不得 import 未物化的外部源文件（避免孤儿模块）
        const hostEntry = readFileSync(join(buildRes.outputDir, "entry-host.js"), "utf-8");
        assert.ok(!(hostEntry).includes("calc.ts"));
        assert.ok((hostEntry).includes("greet.ts"));
      } finally {
        safeCleanDir(extDir);
      }
    });

    it("vendorDeps 完整物化嵌套 node_modules 传递依赖树", async () => {
      // 在项目 node_modules 下构造携带嵌套传递依赖的生产依赖
      const depDir = join(tempDir, "node_modules", "vendor-nested-dep");
      mkdirSync(join(depDir, "lib"), { recursive: true });
      writeFileSync(
        join(depDir, "package.json"),
        JSON.stringify({ name: "vendor-nested-dep", version: "1.0.0", main: "lib/index.js" }),
        "utf-8"
      );
      writeFileSync(join(depDir, "lib", "index.js"), "module.exports = 'root';", "utf-8");

      const transitiveDir = join(depDir, "node_modules", "vendor-transitive-dep");
      mkdirSync(transitiveDir, { recursive: true });
      writeFileSync(
        join(transitiveDir, "package.json"),
        JSON.stringify({ name: "vendor-transitive-dep", version: "2.0.0", main: "index.js" }),
        "utf-8"
      );
      writeFileSync(join(transitiveDir, "index.js"), "module.exports = 'transitive';", "utf-8");

      const pkgPath = join(tempDir, "package.json");
      const pkgData = JSON.parse(readFileSync(pkgPath, "utf-8"));
      pkgData.dependencies = {
        ...pkgData.dependencies,
        "vendor-nested-dep": "^1.0.0",
      };
      writeFileSync(pkgPath, JSON.stringify(pkgData, null, 2), "utf-8");

      const buildRes = await buildProject({
        projectRoot: tempDir,
        vendorDeps: true,
      });

      assert.strictEqual(buildRes.vendorDeps, true);
      // 嵌套 node_modules 内的传递依赖必须完整物化，否则产物运行时 Cannot find module
      const nestedPkg = join(
        buildRes.outputDir,
        "node_modules",
        "vendor-nested-dep",
        "node_modules",
        "vendor-transitive-dep",
        "package.json"
      );
      assert.strictEqual(existsSync(nestedPkg), true);
      const nestedMeta = JSON.parse(readFileSync(nestedPkg, "utf-8"));
      assert.strictEqual(nestedMeta.name, "vendor-transitive-dep");
    });

    it("生命周期脚本与可复现性检查：要求可复现且必须执行安装脚本时报错拒绝", async () => {
      // 模拟包含安装脚本的外部依赖
      const fakeDepDir = join(tempDir, "node_modules", "lifecycle-dep");
      mkdirSync(fakeDepDir, { recursive: true });
      writeFileSync(
        join(fakeDepDir, "package.json"),
        JSON.stringify({
          name: "lifecycle-dep",
          version: "1.0.0",
          scripts: {
            postinstall: "node install.js",
          },
        }),
        "utf-8"
      );

      // 在项目 package.json 中加入该依赖
      const pkgPath = join(tempDir, "package.json");
      const pkgData = JSON.parse(readFileSync(pkgPath, "utf-8"));
      pkgData.dependencies = {
        ...pkgData.dependencies,
        "lifecycle-dep": "^1.0.0",
      };
      writeFileSync(pkgPath, JSON.stringify(pkgData, null, 2), "utf-8");

      let error: any;
      try {
        await buildProject({
          projectRoot: tempDir,
          vendorDeps: true,
          allowInstallScripts: true,
          requireReproducible: true,
        });
      } catch (err) {
        error = err;
      }

      assert.ok(error instanceof BuilderError);
      assert.strictEqual(error.code, "REPRODUCIBLE_BUILD_VIOLATION");
    });
  });

  describe("packProject: npm Action 包打包", () => {
    it("支持 dry-run 模式进行预检与清单生成而不生成最终压缩包", async () => {
      const dryResult = await packProject({
        projectRoot: tempDir,
        dryRun: true,
      });

      assert.strictEqual(dryResult.packageId, "test.builder-fixture");
      assert.strictEqual(dryResult.manifestSummary.actionsCount, 1);
      assert.ok((dryResult.manifestSummary.actions).includes("sample.greet"));
      assert.strictEqual(dryResult.tarballPath, undefined);
    });

    it("npm 实名与本地拼接名不一致时 PackResult 采用 npm 原始产物名", async () => {
      // 将项目 package.json 的 name 改为与 pkgSlug 不同的形式：
      // npm pack 产物名基于 package.json name（大写转小写、下划线转连字符），与本地拼接的 pkgSlug-version.tgz 不一致
      const pkgPath = join(tempDir, "package.json");
      const pkgData = JSON.parse(readFileSync(pkgPath, "utf-8"));
      pkgData.name = "Test_Builder.Fixture";
      writeFileSync(pkgPath, JSON.stringify(pkgData, null, 2), "utf-8");

      const packResult = await packProject({
        projectRoot: tempDir,
      });

      assert.notStrictEqual(packResult.tarballPath, undefined);
      assert.strictEqual(existsSync(packResult.tarballPath!), true);

      // 产物名必须是 npm 实际生成的文件名（基于 package.json name 规范化），而非本地拼接的 builder-fixture-0.1.0.tgz
      assert.strictEqual(packResult.tarballName, "Test_Builder.Fixture-0.1.0.tgz");
      assert.notStrictEqual(packResult.tarballName, "builder-fixture-0.1.0.tgz");
      assert.strictEqual(basename(packResult.tarballPath!), packResult.tarballName);
      assert.ok((packResult.sizeBytes) > 0);
      assert.ok(/^[a-f0-9]{64}$/.test(packResult.sha256));
    });

    it("依托 Node 24 原生类型擦除直接收集并打包 TypeScript 源码与资产", async () => {
      const dryResult = await packProject({
        projectRoot: tempDir,
        dryRun: true,
      });

      // 验证直接打包 TypeScript 源码入口，不生成中间编译的 .d.ts
      assert.ok(dryResult.files.includes("actions/greet.ts"));
      assert.ok(!dryResult.files.some((f) => f.endsWith(".d.ts")));
      assert.ok(dryResult.files.includes("actiondock.json"));
      assert.ok(dryResult.files.includes("package.json"));
    });

    it("将 TypeScript Action 项目打包为标准 tgz 压缩包且不修改源工程", async () => {
      const sourcePkgJson = readFileSync(join(tempDir, "package.json"), "utf-8");
      const sourceGreetCode = readFileSync(join(tempDir, "actions", "greet.ts"), "utf-8");

      const packResult = await packProject({
        projectRoot: tempDir,
      });

      assert.notStrictEqual(packResult.tarballPath, undefined);
      assert.strictEqual(existsSync(packResult.tarballPath!), true);
      assert.strictEqual(packResult.tarballName.endsWith(".tgz"), true);
      assert.ok((packResult.sizeBytes) > 0);
      assert.ok(/^[a-f0-9]{64}$/.test(packResult.sha256));

      // 验证源工程文件未被改写
      assert.strictEqual(readFileSync(join(tempDir, "package.json"), "utf-8"), sourcePkgJson);
      assert.strictEqual(readFileSync(join(tempDir, "actions", "greet.ts"), "utf-8"), sourceGreetCode);
    });
  });

  describe("SkillExporter: Agent Skill 导出与归档", () => {
    it("导出包含标准结构的源码型 Skill", async () => {
      // 写入资产文件
      mkdirSync(join(tempDir, "assets", "nested"), { recursive: true });
      writeFileSync(join(tempDir, "assets", "nested", "data.json"), '{"key": "value"}', "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "sample.greet": {
            entry: "actions/greet.ts",
            description: "Greet a user with configurable greeting",
            inputSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
            uses: [],
          },
        },
        playbooks: {
          "greet-user": {
            entry: "playbooks/greet-user.md",
            description: "SOP for greeting a new user and verifying system health",
            actions: ["sample.greet"],
          },
        },
        assets: ["assets/nested/data.json"],
      };
      saveManifest(tempDir, manifest);

      const outDir = join(tempDir, "dist", "exported-source-skill");
      const exportRes = await exportSkill({
        projectRoot: tempDir,
        mode: "source",
        outDir,
      });

      assert.strictEqual(exportRes.mode, "source");
      assert.strictEqual(exportRes.actionsCount, 1);
      assert.strictEqual(exportRes.playbooksCount, 1);
      assert.strictEqual(existsSync(exportRes.skillDir), true);

      // 1. 验证 SKILL.md
      const skillMdPath = join(exportRes.skillDir, "SKILL.md");
      assert.strictEqual(existsSync(skillMdPath), true);
      const skillMd = readFileSync(skillMdPath, "utf-8");
      assert.strictEqual(skillMd.startsWith("---\nname:"), true);
      assert.ok((skillMd).includes("sample.greet"));

      // 2. 验证已废弃且不再生成 actiondock.skill.json
      const skillJsonPath = join(exportRes.skillDir, "actiondock.skill.json");
      assert.strictEqual(existsSync(skillJsonPath), false);

      // 3. 验证不再生成已废弃的 actiondock.manifest.json 清单
      const manifestPath = join(exportRes.skillDir, "actiondock.manifest.json");
      assert.strictEqual(existsSync(manifestPath), false);

      // 4. 验证 actiondock.json 配置（单一事实源）
      const configPath = join(exportRes.skillDir, "actiondock.json");
      assert.strictEqual(existsSync(configPath), true);
      const exportedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      assert.strictEqual(exportedConfig.id, "test.builder-fixture");
      assert.strictEqual(exportedConfig.schemaVersion, 2);
      assert.notStrictEqual(exportedConfig.actions["sample.greet"], undefined);

      // 5. 验证 package.json
      const pkgPath = join(exportRes.skillDir, "package.json");
      assert.strictEqual(existsSync(pkgPath), true);

      // 6. 验证保留相对路径的 Action 源码
      const actionSrcPath = join(exportRes.skillDir, "actions", "greet.ts");
      assert.strictEqual(existsSync(actionSrcPath), true);

      // 7. 验证保留相对路径的资产文件
      const assetPath = join(exportRes.skillDir, "assets", "nested", "data.json");
      assert.strictEqual(existsSync(assetPath), true);
      assert.strictEqual(readFileSync(assetPath, "utf-8"), '{"key": "value"}');

      // 8. 验证 Playbook 文件
      const pbPath = join(exportRes.skillDir, "playbooks", "greet-user.md");
      assert.strictEqual(existsSync(pbPath), true);
    });

    it("sanitizes dependencies: resolves workspace:* actual versions, excludes file: dependencies, and omits devDependencies", async () => {
      // Create a local sibling package to simulate a monorepo workspace dependency
      const siblingPkgDir = join(tempDir, "packages", "custom-helper");
      mkdirSync(siblingPkgDir, { recursive: true });
      writeFileSync(
        join(siblingPkgDir, "package.json"),
        JSON.stringify({ name: "custom-helper", version: "3.4.5" })
      );

      // Write package.json with various dependency formats in project root
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "test-pkg",
            version: "1.0.0",
            dependencies: {
              "@actiondock/core": "workspace:*",
              "custom-helper": "workspace:*",
              "explicit-dep": "workspace:^2.1.0",
              "external-dep": "^1.0.0",
            },
            devDependencies: {
              typescript: "^5.0.0",
              vitest: "^1.0.0",
            },
          },
          null,
          2
        )
      );

      const outDir = join(tempDir, "dist", "exported-sanitized-skill");
      const exportRes = await exportSkill({
        projectRoot: tempDir,
        mode: "source",
        outDir,
      });

      const exportedPkgPath = join(exportRes.skillDir, "package.json");
      assert.strictEqual(existsSync(exportedPkgPath), true);

      const exportedPkg = JSON.parse(readFileSync(exportedPkgPath, "utf-8"));

      // @actiondock/* workspace:* resolves to internal dependency version
      assert.notStrictEqual(exportedPkg.dependencies["@actiondock/core"], undefined);
      assert.notStrictEqual(exportedPkg.dependencies["@actiondock/sdk"], undefined);

      // Non-actiondock workspace:* resolves to actual package version
      assert.strictEqual(exportedPkg.dependencies["custom-helper"], "^3.4.5");

      // Explicit workspace constraint is stripped cleanly
      assert.strictEqual(exportedPkg.dependencies["explicit-dep"], "^2.1.0");

      // Normal dependencies are preserved
      assert.strictEqual(exportedPkg.dependencies["external-dep"], "^1.0.0");

      // devDependencies are omitted entirely
      assert.strictEqual(exportedPkg.devDependencies, undefined);
    });

    it("exportSkill 对 file: runtime dependencies 严格校验并抛出 BuilderError", async () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-pkg-file-dep",
          version: "1.0.0",
          dependencies: {
            "local-file-dep": "file:../some-local-folder",
          },
        })
      );

      const outDir = join(tempDir, "dist", "exported-file-dep-skill");
      await assert.rejects(
        exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir,
        })
      , BuilderError);
    });

    it("exportSkill 当 workspace:* 依赖无法解析目标版本时抛出 BuilderError", async () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-pkg-unresolvable",
          version: "1.0.0",
          dependencies: {
            "non-existent-workspace-pkg": "workspace:*",
          },
        })
      );

      const outDir = join(tempDir, "dist", "exported-unresolvable-skill");
      await assert.rejects(
        exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir,
        })
      , BuilderError);
    });

    it("getInternalDependencyVersion 正确对齐预发布版本与正式版本", () => {
      // 预发布版本对齐为精确版本
      assert.strictEqual(getInternalDependencyVersion("2.0.0-beta.1"), "2.0.0-beta.1");
      assert.strictEqual(getInternalDependencyVersion("2.0.0-rc.3"), "2.0.0-rc.3");
      // 正式发布版本采用 ^ 语义范围
      assert.strictEqual(getInternalDependencyVersion("2.0.0"), "^2.0.0");
      assert.strictEqual(getInternalDependencyVersion("2.1.3"), "^2.1.3");
    });

    it("导出 Node 目录型 Skill 包并验证可执行性", { timeout: 35000 }, async () => {
      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "sample.greet": {
            entry: "actions/greet.ts",
            description: "Greet a user with configurable greeting",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      const outDir = join(tempDir, "dist", "exported-node-skill");
      const exportRes = await exportSkill({
        projectRoot: tempDir,
        mode: "node",
        outDir,
      });

      assert.strictEqual(exportRes.mode, "node");
      assert.strictEqual(existsSync(exportRes.skillDir), true);

      const entryPath = join(exportRes.skillDir, "entry.mjs");
      assert.strictEqual(existsSync(entryPath), true);

      // 验证生成的 SKILL.md 包含 node 执行说明
      const skillMd = readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
      assert.ok((skillMd).includes("node ./entry.mjs"));

      // 直接执行导出的 Node 入口
      const runProc = runCommandSync([entryPath, "run", "sample.greet", "--input", '{"name": "SkillUser"}', "--json"], {
        env: {
          ...process.env,
          ACTIONDOCK_HOME: tempHome,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      if (runProc.exitCode !== 0) {
        throw new Error(
          `runProc failed with exitCode ${runProc.exitCode}\nSTDOUT: ${runProc.stdout.toString()}\nSTDERR: ${runProc.stderr.toString()}`
        );
      }
      assert.strictEqual(runProc.exitCode, 0);
      const res = JSON.parse(runProc.stdout.toString().trim());
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.data.message, "Hello, SkillUser!");
    });

    it("支持 .zip 与 .tar.gz 两种归档压缩格式", async () => {
      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        id: "test.builder-fixture",
        actions: {
          "sample.greet": {
            entry: "actions/greet.ts",
            description: "Greet action",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      // 1. 验证 zip 归档
      const zipRes = await exportSkill({
        projectRoot: tempDir,
        outDir: join(tempDir, "dist", "skill-for-zip"),
        archive: "zip",
      });
      assert.notStrictEqual(zipRes.archivePath, undefined);
      assert.strictEqual(zipRes.archivePath!.endsWith(".zip"), true);
      assert.strictEqual(existsSync(zipRes.archivePath!), true);

      // 2. 验证 tar.gz 归档
      const tarRes = await exportSkill({
        projectRoot: tempDir,
        outDir: join(tempDir, "dist", "skill-for-tar"),
        archive: "tar.gz",
      });
      assert.notStrictEqual(tarRes.archivePath, undefined);
      assert.strictEqual(tarRes.archivePath!.endsWith(".tar.gz"), true);
      assert.strictEqual(existsSync(tarRes.archivePath!), true);

      // 3. 纯代码解包两种归档，与各自导出目录逐文件比对内容（不依赖外部解压命令）
      const zipExpected = collectFiles(zipRes.skillDir);
      assert.ok((zipExpected.size) > 0);

      const zipEntries = readZipEntries(zipRes.archivePath!);
      // zip 含目录条目，文件条目数应与源一致
      const zipFiles = [...zipEntries].filter(([, v]) => v !== null);
      assert.strictEqual(zipFiles.length, zipExpected.size);
      for (const [relPath, content] of zipExpected) {
        const archived = zipEntries.get(relPath);
        assert.notStrictEqual(archived, undefined);
        assert.strictEqual(archived!.equals(content), true);
      }

      const tarExpected = collectFiles(tarRes.skillDir);
      assert.strictEqual(tarExpected.size, zipExpected.size);
      const tarEntries = readTarGzEntries(tarRes.archivePath!);
      // tar 条目包含目录行，文件条目逐项比对
      for (const [relPath, content] of tarExpected) {
        const archived = tarEntries.get(relPath);
        assert.notStrictEqual(archived, undefined);
        assert.strictEqual(archived!.equals(content), true);
      }
    });

    it("打包归档时正确识别并保留可执行文件与 bin 目录权限位 (zip 与 tar.gz)", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-perm-test-"));
      try {
        const binDir = join(archiveTestDir, "bin");
        mkdirSync(binDir, { recursive: true });

        const execScript = join(binDir, "run.sh");
        writeFileSync(execScript, "#!/bin/sh\necho ok\n");
        chmodSync(execScript, 0o755);

        const normalFile = join(archiveTestDir, "readme.txt");
        writeFileSync(normalFile, "Hello World\n");
        chmodSync(normalFile, 0o644);

        const zipOut = join(tempDir, "perm-test.zip");
        const tarOut = join(tempDir, "perm-test.tar.gz");

        await createZipArchiveAsync(archiveTestDir, zipOut);
        await createTarGzArchiveAsync(archiveTestDir, tarOut);

        const rootName = basename(archiveTestDir);

        // 验证 zip 权限位
        const zipModes = readZipEntryModes(zipOut);
        assert.strictEqual(zipModes.get(`${rootName}/bin/run.sh`), 0o100755);
        assert.strictEqual(zipModes.get(`${rootName}/readme.txt`), 0o100644);
        assert.strictEqual(zipModes.get(`${rootName}/bin`), 0o40755);

        // 验证 tar.gz 权限位
        const tarModes = readTarGzEntryModes(tarOut);
        assert.strictEqual(tarModes.get(`${rootName}/bin/run.sh`), 0o755);
        assert.strictEqual(tarModes.get(`${rootName}/readme.txt`), 0o644);
        assert.strictEqual(tarModes.get(`${rootName}/bin`), 0o755);
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("createZipArchiveAsync: 真正流式打包、大文件与 PKZIP Data Descriptor 规范兼容性验证", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-stream-test-"));
      try {
        const binDir = join(archiveTestDir, "bin");
        mkdirSync(binDir, { recursive: true });
        const subDir = join(archiveTestDir, "subdir");
        mkdirSync(subDir, { recursive: true });

        // 1. 空文件
        const emptyFile = join(archiveTestDir, "empty.txt");
        writeFileSync(emptyFile, "");

        // 2. 普通文本文件
        const normalFile = join(archiveTestDir, "readme.txt");
        writeFileSync(normalFile, "Hello Streaming Zip Archive\n");
        chmodSync(normalFile, 0o644);

        // 3. 可执行脚本
        const execScript = join(binDir, "run.sh");
        writeFileSync(execScript, "#!/bin/sh\necho streamed-ok\n");
        chmodSync(execScript, 0o755);

        // 4. 大文件（2MB）
        const largeContent = Buffer.alloc(2 * 1024 * 1024, "ActionDock-Streaming-Zip-Data-Descriptor-2026\n");
        const largeFile = join(subDir, "large.dat");
        writeFileSync(largeFile, largeContent);

        const zipOut = join(tempDir, "stream-test.zip");
        await createZipArchiveAsync(archiveTestDir, zipOut);

        assert.strictEqual(existsSync(zipOut), true);
        const rootName = basename(archiveTestDir);

        // 解包并验证内容一致性
        const zipEntries = readZipEntries(zipOut);
        assert.strictEqual(zipEntries.get(`${rootName}/empty.txt`)?.length, 0);
        assert.strictEqual(zipEntries.get(`${rootName}/readme.txt`)?.toString("utf8"), "Hello Streaming Zip Archive\n");
        assert.strictEqual(zipEntries.get(`${rootName}/bin/run.sh`)?.toString("utf8"), "#!/bin/sh\necho streamed-ok\n");
        const readLarge = zipEntries.get(`${rootName}/subdir/large.dat`);
        assert.notStrictEqual(readLarge, undefined);
        assert.strictEqual(readLarge!.equals(largeContent), true);

        // 验证权限位
        const zipModes = readZipEntryModes(zipOut);
        assert.strictEqual(zipModes.get(`${rootName}/bin/run.sh`), 0o100755);
        assert.strictEqual(zipModes.get(`${rootName}/readme.txt`), 0o100644);
        assert.strictEqual(zipModes.get(`${rootName}/bin`), 0o40755);

        // 二进制结构校验：验证 PKZIP Data Descriptor 规范
        const zipBuf = readFileSync(zipOut);

        // 定位 Central Directory 并校验条目的 Local File Header 与 Data Descriptor
        let eocd = -1;
        for (let i = zipBuf.length - 22; i >= 0; i--) {
          if (zipBuf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
          }
        }
        assert.ok((eocd) > 0);

        const entryCount = zipBuf.readUInt16LE(eocd + 10);
        let ptr = zipBuf.readUInt32LE(eocd + 16);

        for (let i = 0; i < entryCount; i++) {
          assert.strictEqual(zipBuf.readUInt32LE(ptr), 0x02014b50);
          const flag = zipBuf.readUInt16LE(ptr + 8);
          const method = zipBuf.readUInt16LE(ptr + 10);
          const crc = zipBuf.readUInt32LE(ptr + 16);
          const compSize = zipBuf.readUInt32LE(ptr + 20);
          const uncompSize = zipBuf.readUInt32LE(ptr + 24);
          const nameLen = zipBuf.readUInt16LE(ptr + 28);
          const extraLen = zipBuf.readUInt16LE(ptr + 30);
          const commentLen = zipBuf.readUInt16LE(ptr + 32);
          const localOffset = zipBuf.readUInt32LE(ptr + 42);
          const entryName = zipBuf.toString("utf8", ptr + 46, ptr + 46 + nameLen);

          // Local Header 检验
          assert.strictEqual(zipBuf.readUInt32LE(localOffset), 0x04034b50);
          const localFlag = zipBuf.readUInt16LE(localOffset + 6);
          const localMethod = zipBuf.readUInt16LE(localOffset + 8);
          const localCrc = zipBuf.readUInt32LE(localOffset + 14);
          const localComp = zipBuf.readUInt32LE(localOffset + 18);
          const localUncomp = zipBuf.readUInt32LE(localOffset + 22);

          if (entryName.endsWith("/") || entryName.endsWith("empty.txt")) {
            // 目录与空文件：Stored 模式，无需 Data Descriptor
            assert.strictEqual(localFlag, 0x0800);
            assert.strictEqual(localMethod, 0);
            assert.strictEqual(localCrc, 0);
            assert.strictEqual(localComp, 0);
            assert.strictEqual(localUncomp, 0);
          } else {
            // 非空文件：Deflate 模式且启用 bit 3 Data Descriptor
            assert.strictEqual(localFlag, 0x0808);
            assert.strictEqual(flag, 0x0808);
            assert.strictEqual(localMethod, 8);
            assert.strictEqual(method, 8);
            // Local Header 中的 crc/尺寸字段置 0
            assert.strictEqual(localCrc, 0);
            assert.strictEqual(localComp, 0);
            assert.strictEqual(localUncomp, 0);
            // Central Directory 中必须记录真实值
            assert.ok((crc) > 0);
            assert.ok((compSize) > 0);
            assert.ok((uncompSize) > 0);

            // 紧随压缩数据之后存在 16 字节 Data Descriptor
            const localNameLen = zipBuf.readUInt16LE(localOffset + 26);
            const localExtraLen = zipBuf.readUInt16LE(localOffset + 28);
            const ddOffset = localOffset + 30 + localNameLen + localExtraLen + compSize;

            assert.strictEqual(zipBuf.readUInt32LE(ddOffset), 0x08074b50); // 签名
            assert.strictEqual(zipBuf.readUInt32LE(ddOffset + 4), crc); // CRC32
            assert.strictEqual(zipBuf.readUInt32LE(ddOffset + 8), compSize); // 压缩尺寸
            assert.strictEqual(zipBuf.readUInt32LE(ddOffset + 12), uncompSize); // 原始尺寸
          }

          ptr += 46 + nameLen + extraLen + commentLen;
        }
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("createTarGzArchiveAsync: 真正流式打包、大文件与 USTAR 规范归档内容及权限一致性验证", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-tar-stream-test-"));
      try {
        const binDir = join(archiveTestDir, "bin");
        mkdirSync(binDir, { recursive: true });
        const subDir = join(archiveTestDir, "subdir");
        mkdirSync(subDir, { recursive: true });

        // 空文件
        const emptyFile = join(archiveTestDir, "empty.txt");
        writeFileSync(emptyFile, "");

        // 普通文本文件
        const normalFile = join(archiveTestDir, "readme.txt");
        writeFileSync(normalFile, "Hello Streaming TarGz Archive\n");
        chmodSync(normalFile, 0o644);

        // 可执行脚本
        const execScript = join(binDir, "run.sh");
        writeFileSync(execScript, "#!/bin/sh\necho streamed-tar-ok\n");
        chmodSync(execScript, 0o755);

        // 大文件（2MB，包含非 512 对齐字节数以检验块对齐与跨块流式写入）
        const largeContent = Buffer.alloc(2 * 1024 * 1024 + 123, "ActionDock-Streaming-TarGz-USTAR-2026\n");
        const largeFile = join(subDir, "large.dat");
        writeFileSync(largeFile, largeContent);

        const tarOut = join(tempDir, "stream-test.tar.gz");
        await createTarGzArchiveAsync(archiveTestDir, tarOut);

        assert.strictEqual(existsSync(tarOut), true);
        const rootName = basename(archiveTestDir);

        // 解包并验证各条目内容与尺寸一致性
        const tarEntries = readTarGzEntries(tarOut);
        assert.strictEqual(tarEntries.get(`${rootName}/empty.txt`)?.length, 0);
        assert.strictEqual(tarEntries.get(`${rootName}/readme.txt`)?.toString("utf8"), "Hello Streaming TarGz Archive\n");
        assert.strictEqual(tarEntries.get(`${rootName}/bin/run.sh`)?.toString("utf8"), "#!/bin/sh\necho streamed-tar-ok\n");
        const readLarge = tarEntries.get(`${rootName}/subdir/large.dat`);
        assert.notStrictEqual(readLarge, undefined);
        assert.strictEqual(readLarge!.equals(largeContent), true);

        // 验证权限属性一致性
        const tarModes = readTarGzEntryModes(tarOut);
        assert.strictEqual(tarModes.get(`${rootName}/bin/run.sh`), 0o755);
        assert.strictEqual(tarModes.get(`${rootName}/readme.txt`), 0o644);
        assert.strictEqual(tarModes.get(`${rootName}/bin`), 0o755);
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("createTarGzArchiveAsync: 下游写入发生背压时背压等待逻辑生效并平稳完成归档", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-backpressure-test-"));
      try {
        const payload = Buffer.alloc(512 * 1024 + 321, "BACKPRESSURE-PIPELINE-TEST-CHUNK\n");
        writeFileSync(join(archiveTestDir, "payload.bin"), payload);

        const tarOut = join(tempDir, "backpressure-test.tar.gz");

        let gzipDrainEventCount = 0;
        let gzipBackpressureCount = 0;

        // 构造具备低块尺寸（1KB）并统计背压事件的 gzip 实例
        const customGzipFactory = () => {
          const gz = createGzip({ level: 9, chunkSize: 1024 });
          const originalWrite = gz.write.bind(gz);
          gz.write = function (chunk: any, ...args: any[]) {
            const accepted = originalWrite(chunk, ...args);
            if (!accepted) {
              gzipBackpressureCount++;
            }
            return accepted;
          };
          gz.on("drain", () => {
            gzipDrainEventCount++;
          });
          return gz;
        };

        // 构造限速下游写入流，每次写入注入微小延迟以持续产生背压
        const realWriteStream = createWriteStream(tarOut);
        const throttledWriteStream = () => {
          return new Writable({
            highWaterMark: 1024,
            write(chunk, _encoding, callback) {
              const ok = realWriteStream.write(chunk);
              if (!ok) {
                realWriteStream.once("drain", () => {
                  callback();
                });
              } else {
                setTimeout(callback, 2);
              }
            },
            final(callback) {
              realWriteStream.end(callback);
            },
            destroy(err, callback) {
              realWriteStream.destroy(err ?? undefined);
              callback(err);
            },
          });
        };

        await createTarGzArchiveAsync(archiveTestDir, tarOut, {
          createGzip: customGzipFactory,
          createWriteStream: throttledWriteStream,
        });

        // 确认背压事件切实触发并被安全等待与恢复
        assert.ok((gzipBackpressureCount) > 0);
        assert.ok((gzipDrainEventCount) > 0);

        // 验证归档内容在背压等待恢复后无损完整
        const rootName = basename(archiveTestDir);
        const tarEntries = readTarGzEntries(tarOut);
        const archivedPayload = tarEntries.get(`${rootName}/payload.bin`);
        assert.notStrictEqual(archivedPayload, undefined);
        assert.strictEqual(archivedPayload!.equals(payload), true);
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("createTarGzArchiveAsync: 遇到可读流异常时 Promise 正确捕获并拒绝", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-read-error-test-"));
      try {
        const normalFile = join(archiveTestDir, "normal.txt");
        writeFileSync(normalFile, "normal preamble content", "utf-8");
        const corruptFile = join(archiveTestDir, "corrupt.txt");
        writeFileSync(corruptFile, "will fail during read", "utf-8");

        const tarOut = join(tempDir, "read-error-test.tar.gz");
        const simulatedReadError = new Error("SIMULATED_DISK_IO_READ_FAILURE");

        // 模拟读取至故障文件时抛出异常的可读流
        const failingReadStreamFactory = (filePath: string) => {
          if (filePath.endsWith("corrupt.txt")) {
            return new Readable({
              read() {
                process.nextTick(() => {
                  this.destroy(simulatedReadError);
                });
              },
            });
          }
          return createReadStream(filePath);
        };

        let caughtError: Error | null = null;
        try {
          await createTarGzArchiveAsync(archiveTestDir, tarOut, {
            createReadStream: failingReadStreamFactory,
          });
        } catch (err) {
          caughtError = err as Error;
        }

        assert.notStrictEqual(caughtError, undefined);
        assert.strictEqual(caughtError?.message, "SIMULATED_DISK_IO_READ_FAILURE");
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("createTarGzArchiveAsync: 遇到下游可写流异常时 Promise 正确捕获并拒绝", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-write-error-test-"));
      try {
        const dataFile = join(archiveTestDir, "data.txt");
        writeFileSync(dataFile, "content for write failure test", "utf-8");

        const tarOut = join(tempDir, "write-error-test.tar.gz");
        const simulatedWriteError = new Error("SIMULATED_DISK_FULL_WRITE_FAILURE");

        // 模拟写入端故障的可写流
        const failingWriteStreamFactory = () => {
          return new Writable({
            write(_chunk, _encoding, callback) {
              callback(simulatedWriteError);
            },
          });
        };

        let caughtError: Error | null = null;
        try {
          await createTarGzArchiveAsync(archiveTestDir, tarOut, {
            createWriteStream: failingWriteStreamFactory,
          });
        } catch (err) {
          caughtError = err as Error;
        }

        assert.notStrictEqual(caughtError, undefined);
        assert.strictEqual(caughtError?.message, "SIMULATED_DISK_FULL_WRITE_FAILURE");
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("writeToStream: 背压等待、流销毁与异常拦截边界校验", async () => {
      // 校验正常非背压写入
      const stream = new Writable({
        highWaterMark: 1024,
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      await (writeToStream(stream, Buffer.from("quick chunk")));

      // 校验已销毁流直接拒绝
      stream.destroy();
      await assert.rejects(writeToStream(stream, Buffer.from("fail chunk")), /Target stream has been destroyed/);

      // 校验背压挂起并在 drain 后成功恢复
      const callbacks: (() => void)[] = [];
      const backpressuredStream = new Writable({
        highWaterMark: 10,
        write(_chunk, _encoding, callback) {
          callbacks.push(callback);
        },
      });

      // 填满缓冲区促使下一次写入返回 false
      backpressuredStream.write(Buffer.alloc(10));

      let writePromiseResolved = false;
      const writePromise = writeToStream(backpressuredStream, Buffer.alloc(10)).then(() => {
        writePromiseResolved = true;
      });

      // 验证在 drain 事件触发前 Promise 保持挂起
      assert.strictEqual(writePromiseResolved, false);

      // 消费底层缓冲区触发 drain
      callbacks[0]();
      callbacks[1]();
      await writePromise;
      assert.strictEqual(writePromiseResolved, true);

      // 校验在等待 drain 期间流发生错误时安全拒绝
      const failingStream = new Writable({
        highWaterMark: 10,
        write(_chunk, _encoding, _callback) {},
      });
      failingStream.write(Buffer.alloc(10));
      const testError = new Error("STREAM_ASYNC_ERROR");
      const failingPromise = writeToStream(failingStream, Buffer.alloc(10));
      failingStream.destroy(testError);
      await assert.rejects(failingPromise, /STREAM_ASYNC_ERROR/);
    });

    it("指向归档目录外部的软链接不会被打包进归档 (zip 与 tar.gz)", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-escape-test-"));
      const outsideDir = mkdtempSync(join(tmpdir(), "ad-archive-outside-"));
      try {
        const secretFile = join(outsideDir, "secret.txt");
        writeFileSync(secretFile, "sensitive data outside boundary", "utf-8");

        const normalFile = join(archiveTestDir, "normal.txt");
        writeFileSync(normalFile, "safe normal content", "utf-8");

        // 创建指向外部敏感文件的软链接
        const linkToOutsideFile = join(archiveTestDir, "escaped-link.txt");
        symlinkSync(secretFile, linkToOutsideFile);

        // 创建指向外部目录的软链接
        const linkToOutsideDir = join(archiveTestDir, "escaped-dir");
        symlinkSync(outsideDir, linkToOutsideDir, "junction");

        const zipOut = join(tempDir, "escape-test.zip");
        const tarOut = join(tempDir, "escape-test.tar.gz");
        const zipAsyncOut = join(tempDir, "escape-test-async.zip");
        const tarAsyncOut = join(tempDir, "escape-test-async.tar.gz");

        await createZipArchiveAsync(archiveTestDir, zipOut);
        await createTarGzArchiveAsync(archiveTestDir, tarOut);
        await createZipArchiveAsync(archiveTestDir, zipAsyncOut);
        await createTarGzArchiveAsync(archiveTestDir, tarAsyncOut);

        const rootName = basename(archiveTestDir);

        for (const out of [zipOut, zipAsyncOut]) {
          const zipEntries = readZipEntries(out);
          assert.strictEqual(zipEntries.has(`${rootName}/normal.txt`), true);
          assert.strictEqual(zipEntries.get(`${rootName}/normal.txt`)?.toString("utf-8"), "safe normal content");
          assert.strictEqual(zipEntries.has(`${rootName}/escaped-link.txt`), false);
          assert.strictEqual(zipEntries.has(`${rootName}/escaped-dir`), false);
          assert.strictEqual(zipEntries.has(`${rootName}/escaped-dir/secret.txt`), false);
        }

        for (const out of [tarOut, tarAsyncOut]) {
          const tarEntries = readTarGzEntries(out);
          assert.strictEqual(tarEntries.has(`${rootName}/normal.txt`), true);
          assert.strictEqual(tarEntries.get(`${rootName}/normal.txt`)?.toString("utf-8"), "safe normal content");
          assert.strictEqual(tarEntries.has(`${rootName}/escaped-link.txt`), false);
          assert.strictEqual(tarEntries.has(`${rootName}/escaped-dir`), false);
          assert.strictEqual(tarEntries.has(`${rootName}/escaped-dir/secret.txt`), false);
        }
      } finally {
        safeCleanDir(archiveTestDir);
        safeCleanDir(outsideDir);
      }
    });

    it("存在循环软链接时不会无限递归并能安全完成打包 (zip 与 tar.gz)", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-cycle-test-"));
      try {
        const rootFile = join(archiveTestDir, "root-file.txt");
        writeFileSync(rootFile, "root file content", "utf-8");

        const subDir = join(archiveTestDir, "subdir");
        mkdirSync(subDir, { recursive: true });
        const subFile = join(subDir, "sub-file.txt");
        writeFileSync(subFile, "sub file content", "utf-8");

        // 指向根目录的循环软链接
        symlinkSync(archiveTestDir, join(subDir, "loop-to-root"), "junction");
        // 指向当前子目录自身的循环软链接
        symlinkSync(subDir, join(subDir, "loop-to-self"), "junction");

        const zipOut = join(tempDir, "cycle-test.zip");
        const tarOut = join(tempDir, "cycle-test.tar.gz");
        const zipAsyncOut = join(tempDir, "cycle-test-async.zip");
        const tarAsyncOut = join(tempDir, "cycle-test-async.tar.gz");

        // 验证异步流式打包接口能安全完成且不会出现无限递归与栈溢出
        await createZipArchiveAsync(archiveTestDir, zipOut);
        await createTarGzArchiveAsync(archiveTestDir, tarOut);
        await createZipArchiveAsync(archiveTestDir, zipAsyncOut);
        await createTarGzArchiveAsync(archiveTestDir, tarAsyncOut);

        const rootName = basename(archiveTestDir);

        for (const out of [zipOut, zipAsyncOut]) {
          const zipEntries = readZipEntries(out);
          assert.strictEqual(zipEntries.has(`${rootName}/root-file.txt`), true);
          assert.strictEqual(zipEntries.get(`${rootName}/root-file.txt`)?.toString("utf-8"), "root file content");
          assert.strictEqual(zipEntries.has(`${rootName}/subdir/sub-file.txt`), true);
          assert.strictEqual(zipEntries.get(`${rootName}/subdir/sub-file.txt`)?.toString("utf-8"), "sub file content");
        }

        for (const out of [tarOut, tarAsyncOut]) {
          const tarEntries = readTarGzEntries(out);
          assert.strictEqual(tarEntries.has(`${rootName}/root-file.txt`), true);
          assert.strictEqual(tarEntries.get(`${rootName}/root-file.txt`)?.toString("utf-8"), "root file content");
          assert.strictEqual(tarEntries.has(`${rootName}/subdir/sub-file.txt`), true);
          assert.strictEqual(tarEntries.get(`${rootName}/subdir/sub-file.txt`)?.toString("utf-8"), "sub file content");
        }
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("正常的软链接与普通文件能够正常打包 (zip 与 tar.gz)", async () => {
      const archiveTestDir = mkdtempSync(join(tmpdir(), "ad-archive-valid-test-"));
      try {
        // 普通文件
        const normalFile = join(archiveTestDir, "normal.txt");
        writeFileSync(normalFile, "normal content", "utf-8");

        // 子目录及其内部普通文件
        const subDir = join(archiveTestDir, "nested");
        mkdirSync(subDir, { recursive: true });
        const nestedFile = join(subDir, "nested-file.txt");
        writeFileSync(nestedFile, "nested content", "utf-8");

        // 指向同一归档目录内目标文件的软链接
        const targetFile = join(archiveTestDir, "target.txt");
        writeFileSync(targetFile, "target content", "utf-8");
        const linkFile = join(archiveTestDir, "link-to-target.txt");
        symlinkSync(targetFile, linkFile);

        const zipOut = join(tempDir, "valid-test.zip");
        const tarOut = join(tempDir, "valid-test.tar.gz");
        const zipAsyncOut = join(tempDir, "valid-test-async.zip");
        const tarAsyncOut = join(tempDir, "valid-test-async.tar.gz");

        await createZipArchiveAsync(archiveTestDir, zipOut);
        await createTarGzArchiveAsync(archiveTestDir, tarOut);
        await createZipArchiveAsync(archiveTestDir, zipAsyncOut);
        await createTarGzArchiveAsync(archiveTestDir, tarAsyncOut);

        const rootName = basename(archiveTestDir);

        for (const out of [zipOut, zipAsyncOut]) {
          const zipEntries = readZipEntries(out);
          assert.strictEqual(zipEntries.has(`${rootName}/normal.txt`), true);
          assert.strictEqual(zipEntries.get(`${rootName}/normal.txt`)?.toString("utf-8"), "normal content");
          assert.strictEqual(zipEntries.has(`${rootName}/nested/nested-file.txt`), true);
          assert.strictEqual(zipEntries.get(`${rootName}/nested/nested-file.txt`)?.toString("utf-8"), "nested content");
          // 验证指向内部文件的软链接能够成功打包且内容解析正确
          assert.strictEqual(zipEntries.has(`${rootName}/link-to-target.txt`), true);
          assert.strictEqual(zipEntries.get(`${rootName}/link-to-target.txt`)?.toString("utf-8"), "target content");
        }

        for (const out of [tarOut, tarAsyncOut]) {
          const tarEntries = readTarGzEntries(out);
          assert.strictEqual(tarEntries.has(`${rootName}/normal.txt`), true);
          assert.strictEqual(tarEntries.get(`${rootName}/normal.txt`)?.toString("utf-8"), "normal content");
          assert.strictEqual(tarEntries.has(`${rootName}/nested/nested-file.txt`), true);
          assert.strictEqual(tarEntries.get(`${rootName}/nested/nested-file.txt`)?.toString("utf-8"), "nested content");
          // 验证指向内部文件的软链接能够成功打包且内容解析正确
          assert.strictEqual(tarEntries.has(`${rootName}/link-to-target.txt`), true);
          assert.strictEqual(tarEntries.get(`${rootName}/link-to-target.txt`)?.toString("utf-8"), "target content");
        }
      } finally {
        safeCleanDir(archiveTestDir);
      }
    });

    it("复合导出拒绝空项目列表", async () => {
      await assert.rejects(exportCompositeSkill({ bundleName: "empty-suite", projectRoots: [] }), BuilderError);
    });

    it("支持多包复合套件导出与归档压缩 (exportCompositeSkill)", async () => {
      const pkg2Dir = mkdtempSync(join(tmpdir(), "ad-builder-test-pkg2-"));
      try {
        initProject(pkg2Dir, {
          id: "test.second-package",
          name: "Second Package",
          description: "Second test package",
        });

        mkdirSync(join(pkg2Dir, "playbooks"), { recursive: true });
        writeFileSync(
          join(pkg2Dir, "playbooks", "deploy.md"),
          `# 部署规程`,
          "utf-8"
        );
        const pkg2Manifest = JSON.parse(readFileSync(join(pkg2Dir, "actiondock.json"), "utf-8"));
        pkg2Manifest.playbooks = {
          deploy: {
            entry: "playbooks/deploy.md",
            description: "自动化部署标准流程",
          },
        };
        writeFileSync(join(pkg2Dir, "actiondock.json"), JSON.stringify(pkg2Manifest, null, 2));

        const compositeRes = await exportCompositeSkill({
          bundleName: "test-composite-suite",
          projectRoots: [tempDir, pkg2Dir],
          outDir: join(tempDir, "dist", "my-suite"),
          archive: true,
        });

        assert.strictEqual(compositeRes.bundleName, "test-composite-suite");
        assert.strictEqual(compositeRes.packagesCount, 2);
        assert.ok((compositeRes.playbooksCount) >= 1);
        assert.strictEqual(existsSync(join(compositeRes.skillDir, "SKILL.md")), true);
        assert.strictEqual(existsSync(join(compositeRes.skillDir, "actiondock.skill.json")), false);
        assert.strictEqual(existsSync(join(compositeRes.skillDir, "packages", "builder-fixture")), true);
        assert.strictEqual(existsSync(join(compositeRes.skillDir, "packages", "second-package")), true);
        // 验证子包原位保留代码但不再包含独立的 SKILL.md，对外保持单一 Skill 入口
        assert.strictEqual(existsSync(join(compositeRes.skillDir, "packages", "builder-fixture", "SKILL.md")), false);
        assert.strictEqual(existsSync(join(compositeRes.skillDir, "packages", "second-package", "SKILL.md")), false);

        // 验证物理 Playbook 文件与 SKILL.md 相对路径严格一致
        const expectedPbPath = join(compositeRes.skillDir, "packages", "second-package", "playbooks", "deploy.md");
        assert.strictEqual(existsSync(expectedPbPath), true);

        const skillMd = readFileSync(join(compositeRes.skillDir, "SKILL.md"), "utf-8");
        assert.ok((skillMd).includes("test-composite-suite"));
        assert.ok((skillMd).includes("test.builder-fixture"));
        assert.ok((skillMd).includes("test.second-package"));
        assert.ok((skillMd).includes("packages/second-package/playbooks/deploy.md"));
        assert.ok((skillMd).includes("ad link"));
        assert.ok((skillMd).includes("故障排查与环境安装指引"));
        assert.ok((skillMd).includes("npm install --omit=dev"));

        // 验证归档产物
        assert.notStrictEqual(compositeRes.archivePath, undefined);
        assert.strictEqual(existsSync(compositeRes.archivePath!), true);
      } finally {
        safeCleanDir(pkg2Dir);
      }
    });

    it("归档压缩失败时旧档保留且临时半成品被清理，不留中间态", async () => {
      const outDir = join(tempDir, "dist", "archive-fail-skill");
      mkdirSync(join(tempDir, "dist"), { recursive: true });

      // 将最终归档路径占用为非空目录：压缩成功但原子重命名必然失败（EISDIR/ENOTEMPTY），注入确定性失败
      const occupiedArchivePath = `${outDir}.zip`;
      mkdirSync(occupiedArchivePath, { recursive: true });
      writeFileSync(join(occupiedArchivePath, "previous-good.txt"), "PREVIOUS-GOOD-ARCHIVE-CONTENT", "utf-8");

      let caught: any;
      try {
        await exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir,
          archive: true,
          archiveFormat: "zip",
        });
      } catch (err) {
        caught = err;
      }

      assert.ok(caught instanceof BuilderError);
      assert.ok((caught.message).includes("Failed to create zip archive"));

      // 已有产物原样保留，未被删除或改写
      assert.strictEqual(existsSync(join(occupiedArchivePath, "previous-good.txt")), true);
      assert.strictEqual(readFileSync(join(occupiedArchivePath, "previous-good.txt"), "utf-8"), 
        "PREVIOUS-GOOD-ARCHIVE-CONTENT"
      );

      // 临时半成品被清理，不残留 .tmp 中间态
      assert.strictEqual(existsSync(`${occupiedArchivePath}.tmp`), false);
    });

    it("归档成功时临时文件原子重命名到位且无 .tmp 残留", async () => {
      const outDir = join(tempDir, "dist", "archive-ok-skill");
      const res = await exportSkill({
        projectRoot: tempDir,
        mode: "source",
        outDir,
        archive: true,
        archiveFormat: "zip",
      });

      assert.strictEqual(res.archivePath, `${outDir}.zip`);
      assert.strictEqual(existsSync(res.archivePath!), true);
      assert.strictEqual(existsSync(`${res.archivePath}.tmp`), false);
      // 归档内容可用且包含核心产物
      const entries = readZipEntries(res.archivePath!);
      const rootName = basename(outDir);
      assert.strictEqual(entries.has(`${rootName}/SKILL.md`), true);
      assert.strictEqual(entries.has(`${rootName}/actiondock.json`), true);
    });

    it("单包导出若当前动作目录已有 SKILL.md 则直接复用不再自动生成", async () => {
      const customSkillContent = `# Custom Pre-existing Skill Document\n\nCustom instructions for agent.`;
      const customSkillPath = join(tempDir, "SKILL.md");
      writeFileSync(customSkillPath, customSkillContent, "utf-8");

      try {
        const res = await exportSkill({
          projectRoot: tempDir,
          outDir: join(tempDir, "dist", "custom-reused-skill"),
        });

        assert.strictEqual(res.usedExistingSkillMd, customSkillPath);
        assert.strictEqual(existsSync(join(res.skillDir, "SKILL.md")), true);
        const copiedContent = readFileSync(join(res.skillDir, "SKILL.md"), "utf-8");
        assert.strictEqual(copiedContent, customSkillContent);
      } finally {
        try {
          rmSync(customSkillPath, { force: true });
        } catch {}
      }
    });

    it("复合导出若当前工作区已有 SKILL.md 则直接复用不再自动生成", async () => {
      const workspaceDir = mkdtempSync(join(tmpdir(), "ad-composite-ws-"));
      const pkgADir = join(workspaceDir, "packages", "pkg-a");
      const pkgBDir = join(workspaceDir, "packages", "pkg-b");

      try {
        initProject(pkgADir, { id: "test.pkg-a", name: "Pkg A" });
        initProject(pkgBDir, { id: "test.pkg-b", name: "Pkg B" });

        // 在工作区目录下创建定制的 SKILL.md
        const wsSkillDir = join(workspaceDir, "skills", "my-custom-suite");
        mkdirSync(wsSkillDir, { recursive: true });
        const customSkillContent = `# Pre-existing Workspace Composite Skill\n\nTailored agent instructions.`;
        writeFileSync(join(wsSkillDir, "SKILL.md"), customSkillContent, "utf-8");

        const res = await exportCompositeSkill({
          bundleName: "my-custom-suite",
          projectRoots: [pkgADir, pkgBDir],
          outDir: join(workspaceDir, "dist", "my-custom-suite"),
          workspaceRoot: workspaceDir,
        });

        assert.strictEqual(res.usedExistingSkillMd, join(wsSkillDir, "SKILL.md"));
        assert.strictEqual(existsSync(join(res.skillDir, "SKILL.md")), true);
        const copiedContent = readFileSync(join(res.skillDir, "SKILL.md"), "utf-8");
        assert.strictEqual(copiedContent, customSkillContent);
        // 内部子包不生成 SKILL.md
        assert.strictEqual(existsSync(join(res.skillDir, "packages", "pkg-a", "SKILL.md")), false);
        assert.strictEqual(existsSync(join(res.skillDir, "packages", "pkg-b", "SKILL.md")), false);
      } finally {
        safeCleanDir(workspaceDir);
      }
    });

    it("引用外部包未在清单声明的隐藏动作时，规划阶段直接报错拦截杜绝幽灵动作混入", async () => {
      const extDir = mkdtempSync(join(tmpdir(), "ext-pkg-"));
      try {
        initProject(extDir, { id: "test.ext-tools", name: "External Tools" });
        // 在外部包 actions 目录下创建未在清单中显式声明的隐藏动作文件
        writeFileSync(
          join(extDir, "actions", "calc.ts"),
          `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "calc", uses: [], run: () => 42 });`
        );
        await linkPackage(extDir);

        const planner = new SelectionPlanner({ projectRoot: tempDir });
        // 引用外部包未声明动作时直接拦截报错
        assert.throws(
          () => {
            planner.plan({
              projectRoot: tempDir,
              manifest: {
                schemaVersion: 1,
                id: "test.builder-fixture",
                actions: {
                  "sample.greet": {
                    entry: "actions/greet.ts",
                    uses: ["test.ext-tools/calc"],
                  },
                },
              },
            });
          },
          (err: any) => {
            return (
              err.code === "ACTION_NOT_FOUND" ||
              err.code === "UNDECLARED_ACTION_DEPENDENCY"
            );
          }
        );

        // 外部包显式补全清单声明后，规划应正常通过
        const extConfigPath = join(extDir, "actiondock.json");
        const extCfg = JSON.parse(readFileSync(extConfigPath, "utf-8"));
        extCfg.actions = extCfg.actions || {};
        extCfg.actions["calc"] = {
          entry: "actions/calc.ts",
          uses: [],
        };
        writeFileSync(extConfigPath, JSON.stringify(extCfg, null, 2), "utf-8");

        const validPlan = planner.plan({
          projectRoot: tempDir,
          manifest: {
            schemaVersion: 1,
            id: "test.builder-fixture",
            actions: {
              "sample.greet": {
                entry: "actions/greet.ts",
                uses: ["test.ext-tools/calc"],
              },
            },
          },
        });

        assert.strictEqual(validPlan.actions.some((a) => a.id === "test.ext-tools/calc"), true);
      } finally {
        safeCleanDir(extDir);
      }
    });

    it("preserves custom actionsDir and playbooksDir in BuildPlan and exported config", async () => {
      const customDir = mkdtempSync(join(tmpdir(), "custom-dirs-pkg-"));
      try {
        writeFileSync(
          join(customDir, "actiondock.json"),
          JSON.stringify({
            schemaVersion: 2,
            id: "custom-dirs-pkg",
            name: "Custom Dirs",
            version: "1.0.0",
            actionsDir: "src/my-actions",
            playbooksDir: "docs/my-playbooks",
            actions: {
              task: { entry: "src/my-actions/task.ts" },
            },
            playbooks: {
              guide: { entry: "docs/my-playbooks/guide.md" },
            },
          })
        );
        mkdirSync(join(customDir, "src", "my-actions"), { recursive: true });
        mkdirSync(join(customDir, "docs", "my-playbooks"), { recursive: true });
        writeFileSync(
          join(customDir, "src", "my-actions", "task.ts"),
          `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "task", run: () => "done" });`
        );
        writeFileSync(
          join(customDir, "docs", "my-playbooks", "guide.md"),
          `# Guide\n`
        );

        const planner = new SelectionPlanner({ projectRoot: customDir });
        const plan = planner.plan({ projectRoot: customDir });
        assert.strictEqual(plan.actionsDir, "src/my-actions");
        assert.strictEqual(plan.playbooksDir, "docs/my-playbooks");

        const outDir = join(customDir, "dist", "exported");
        const expResult = await exportSkill({
          projectRoot: customDir,
          outDir,
        });
        assert.strictEqual(expResult.skillDir, outDir);

        const exportedConfig = JSON.parse(readFileSync(join(outDir, "actiondock.json"), "utf-8"));
        assert.strictEqual(exportedConfig.actionsDir, "src/my-actions");
        assert.strictEqual(exportedConfig.playbooksDir, "docs/my-playbooks");
        assert.strictEqual(existsSync(join(outDir, "docs", "my-playbooks", "guide.md")), true);

        const exportedSkillMd = readFileSync(join(outDir, "SKILL.md"), "utf-8");
        assert.ok((exportedSkillMd).includes("./docs/my-playbooks/guide.md"));
      } finally {
        safeCleanDir(customDir);
      }
    });

    it("creates valid USTAR tar.gz archives with long directory and file paths (>100 chars)", async () => {
      const archiveDir = mkdtempSync(join(tmpdir(), "archive-long-path-"));
      const outTarGz = join(archiveDir, "archive.tar.gz");
      try {
        // Build a path that exceeds 100 bytes
        const deepDir = join(
          archiveDir,
          "very_long_nested_directory_level_1",
          "second_long_nested_directory_level_2",
          "third_long_nested_directory_level_3"
        );
        mkdirSync(deepDir, { recursive: true });
        writeFileSync(join(deepDir, "sample.txt"), "hello long path");

        await createTarGzArchiveAsync(archiveDir, outTarGz);
        assert.strictEqual(existsSync(outTarGz), true);

        const entries = readTarGzEntries(outTarGz);
        const keys = Array.from(entries.keys());
        const dirKey = keys.find((k) => k.includes("third_long_nested_directory_level_3"));
        assert.notStrictEqual(dirKey, undefined);
        // Dir entry path in tar header ends with / or is registered as directory
        assert.ok((dirKey!.length) > 100);
        assert.strictEqual(entries.get(dirKey!), null);

        const fileKey = keys.find((k) => k.endsWith("sample.txt"));
        assert.notStrictEqual(fileKey, undefined);
        assert.strictEqual(entries.get(fileKey!)?.toString("utf-8"), "hello long path");
      } finally {
        safeCleanDir(archiveDir);
      }
    });

    it("在写入端强制自检：assertValidManifestActionIds 拦截不符合规范的 Action ID", () => {
      // 合法 ID 校验通过
      assert.doesNotThrow(() => {
        assertValidManifestActionIds({
          "sample.greet": { entry: "actions/greet.ts" },
          "valid_action-123": { entry: "actions/valid.ts" },
        });
      });

      // 拦截包含命名空间分隔符 / 的 Action ID
      assert.throws(() => {
        assertValidManifestActionIds({
          "test.ext-tools/calc": { entry: "actions/calc.ts" },
        });
      }, BuilderError);

      // 拦截包含大写字母与非法符号的 Action ID
      assert.throws(() => {
        assertValidManifestActionIds({
          "Invalid_Upper": { entry: "actions/test.ts" },
        });
      }, BuilderError);
    });

    it("往返测试：export skill --bundle 与单包源码导出对每个导出包运行 loadActions 零错误", async () => {
      const extDir = mkdtempSync(join(tmpdir(), "ext-roundtrip-"));
      try {
        initProject(extDir, { id: "test.ext-tools", name: "External Tools" });
        writeFileSync(
          join(extDir, "actions", "calc.ts"),
          `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "calc", run: () => 42 });`
        );
        const extManifest = JSON.parse(readFileSync(join(extDir, "actiondock.json"), "utf-8"));
        extManifest.actions = {
          calc: { entry: "actions/calc.ts", description: "Calculate action" },
        };
        writeFileSync(join(extDir, "actiondock.json"), JSON.stringify(extManifest, null, 2));
        await linkPackage(extDir);

        // 主包 sample.greet 声明依赖外部包的 test.ext-tools/calc
        const mainManifestPath = join(tempDir, "actiondock.json");
        const mainManifest = JSON.parse(readFileSync(mainManifestPath, "utf-8"));
        mainManifest.actions["sample.greet"] = {
          entry: "actions/greet.ts",
          uses: ["test.ext-tools/calc"],
        };
        writeFileSync(mainManifestPath, JSON.stringify(mainManifest, null, 2));

        // 1. 测试 exportCompositeSkill (即 export skill --bundle)
        const bundleOut = join(tempDir, "dist", "roundtrip-bundle");
        const compositeRes = await exportCompositeSkill({
          bundleName: "test-roundtrip-suite",
          projectRoots: [tempDir],
          outDir: bundleOut,
        });

        assert.strictEqual(compositeRes.packagesCount, 2);
        const exportedPkgsDir = join(bundleOut, "packages");
        assert.strictEqual(existsSync(exportedPkgsDir), true);

        const subpkgs = readdirSync(exportedPkgsDir);
        assert.ok((subpkgs).includes("builder-fixture"));
        assert.ok((subpkgs).includes("ext-tools"));

        // 验证主包清单只包含自有 Action，跨包依赖不写入主包清单
        const mainExportedManifest = JSON.parse(
          readFileSync(join(exportedPkgsDir, "builder-fixture", "actiondock.json"), "utf-8")
        );
        assert.deepStrictEqual(Object.keys(mainExportedManifest.actions), ["sample.greet"]);
        assert.strictEqual(mainExportedManifest.actions["test.ext-tools/calc"], undefined);
        assert.strictEqual(mainExportedManifest.actions["calc"], undefined);

        // 验证跨包依赖不物化进消费包目录
        assert.strictEqual(existsSync(join(exportedPkgsDir, "builder-fixture", "actions", "greet.ts")), true);
        assert.strictEqual(existsSync(join(exportedPkgsDir, "builder-fixture", "actions", "calc.ts")), false);

        // 验证外部依赖包整包完整保留
        const extExportedManifest = JSON.parse(
          readFileSync(join(exportedPkgsDir, "ext-tools", "actiondock.json"), "utf-8")
        );
        assert.deepStrictEqual(Object.keys(extExportedManifest.actions), ["calc"]);
        assert.strictEqual(existsSync(join(exportedPkgsDir, "ext-tools", "actions", "calc.ts")), true);

        // 往返测试断言：对每个导出包执行 loadActions，必须零错误
        for (const subpkg of subpkgs) {
          const subpkgDir = join(exportedPkgsDir, subpkg);
          const loaded = await loadActions(subpkgDir);
          assert.ok((loaded.size) > 0);
          for (const [id] of loaded) {
            assert.strictEqual(ACTION_ID_REGEX.test(id), true);
          }
        }

        // 2. 测试单包源码导出：如果依赖闭包含外部包，导成 mini-workspace 形态
        const singleOut = join(tempDir, "dist", "roundtrip-single-ws");
        const singleRes = await exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir: singleOut,
        });

        assert.strictEqual(existsSync(join(singleOut, "packages", "builder-fixture")), true);
        assert.strictEqual(existsSync(join(singleOut, "packages", "ext-tools")), true);

        // 对 mini-workspace 下的每个包执行 loadActions，零错误
        const singleSubpkgs = readdirSync(join(singleOut, "packages"));
        for (const subpkg of singleSubpkgs) {
          const subpkgDir = join(singleOut, "packages", subpkg);
          const loaded = await loadActions(subpkgDir);
          assert.ok((loaded.size) > 0);
          for (const [id] of loaded) {
            assert.strictEqual(ACTION_ID_REGEX.test(id), true);
          }
        }
      } finally {
        safeCleanDir(extDir);
      }
    });
  });

  describe("collectRelativeFiles: digest 跨平台可移植性与符号链接防护", () => {
    it("按最终 POSIX 相对路径统一排序：目录序与路径序不一致时仍返回字典序稳定清单", () => {
      // 构造目录序与最终相对路径字典序交叉的场景：目录 z 在目录 a 之前扫描到，但 a 内文件路径更靠前
      const sortRoot = mkdtempSync(join(tmpdir(), "ad-collect-sort-test-"));
      try {
        mkdirSync(join(sortRoot, "z-dir"), { recursive: true });
        writeFileSync(join(sortRoot, "z-dir", "0000.txt"), "z", "utf-8");
        mkdirSync(join(sortRoot, "a-dir"), { recursive: true });
        writeFileSync(join(sortRoot, "a-dir", "zzzz.txt"), "a", "utf-8");
        writeFileSync(join(sortRoot, "root.txt"), "r", "utf-8");

        const files = collectRelativeFiles(sortRoot);
        // 最终相对路径统一字典序：z-dir/0000.txt 应排在 a-dir/zzzz.txt 之后，与逐层目录名排序结果相反
        assert.deepStrictEqual(files, [
          "a-dir/zzzz.txt",
          "root.txt",
          "z-dir/0000.txt",
        ]);
        const sortedCopy = [...files].sort();
        assert.deepStrictEqual(files, sortedCopy);
      } finally {
        safeCleanDir(sortRoot);
      }
    });

    it("指向目录外部的软链接与循环软链接被安全跳过，与归档防护策略一致", () => {
      const linkRoot = mkdtempSync(join(tmpdir(), "ad-collect-link-test-"));
      const outsideDir = mkdtempSync(join(tmpdir(), "ad-collect-outside-"));
      try {
        writeFileSync(join(linkRoot, "normal.txt"), "safe", "utf-8");
        writeFileSync(join(outsideDir, "secret.txt"), "sensitive", "utf-8");
        symlinkSync(join(outsideDir, "secret.txt"), join(linkRoot, "escaped-link.txt"));
        symlinkSync(linkRoot, join(linkRoot, "loop-to-root"), "junction");

        const files = collectRelativeFiles(linkRoot);
        assert.deepStrictEqual(files, ["normal.txt"]);
      } finally {
        safeCleanDir(linkRoot);
        safeCleanDir(outsideDir);
      }
    });
  });

  describe("archive dosDateTime: DOS 时间字段边界钳制", () => {
    it("pre-1980 时间统一映射为 1980-01-01 00:00:00，年份上限 2107 不溢出", async () => {
      // 1. 纯函数级别验证对极端时间戳的数学边界钳制，规避部分操作系统 utimes（如 Windows 32 位 time_t）的底层截断
      const pastDos = dosDateTime(new Date("1975-06-15T12:34:56Z").getTime());
      assert.strictEqual(pastDos.date, ((1980 - 1980) << 9) | (1 << 5) | 1);
      assert.strictEqual(pastDos.time, 0);

      const futureDos = dosDateTime(new Date("2200-01-01T00:00:00Z").getTime());
      assert.strictEqual(((futureDos.date >> 9) & 0x7f) + 1980, 2107);
      assert.ok((futureDos.date) <= 0xffff);
      assert.ok((futureDos.time) <= 0xffff);

      // 2. 归档级集成验证：验证 pre-1980 文件在 zip 归档中的时间头映射
      const timeRoot = mkdtempSync(join(tmpdir(), "ad-dos-time-test-"));
      try {
        mkdirSync(timeRoot, { recursive: true });
        const oldFile = join(timeRoot, "old.txt");
        writeFileSync(oldFile, "old", "utf-8");
        utimesSync(oldFile, new Date("1975-06-15T12:34:56Z"), new Date("1975-06-15T12:34:56Z"));

        const zipOut = join(tempDir, "dos-time-test.zip");
        await createZipArchiveAsync(timeRoot, zipOut);
        assert.strictEqual(existsSync(zipOut), true);

        const rootName = basename(timeRoot);
        const zipBuf = readFileSync(zipOut);

        // 定位 EOCD 并解析 central directory，提取 date/time 字段验证钳制结果
        let eocd = -1;
        for (let i = zipBuf.length - 22; i >= 0; i--) {
          if (zipBuf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
          }
        }
        assert.ok((eocd) > 0);
        const entryCount = zipBuf.readUInt16LE(eocd + 10);
        assert.strictEqual(entryCount, 1);
        const ptr = zipBuf.readUInt32LE(eocd + 16);

        const nameLen = zipBuf.readUInt16LE(ptr + 28);
        const name = zipBuf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
        assert.strictEqual(name, `${rootName}/old.txt`);
        const date = zipBuf.readUInt16LE(ptr + 14);
        const time = zipBuf.readUInt16LE(ptr + 12);

        // pre-1980：映射为 1980-01-01 00:00:00（date=0x0021, time=0）
        assert.strictEqual(date, ((1980 - 1980) << 9) | (1 << 5) | 1);
        assert.strictEqual(time, 0);
      } finally {
        safeCleanDir(timeRoot);
      }
    });
  });

  describe("SkillExporter: 复合导出边界行为与防御", () => {
    it("单包导出传入过滤选项且闭包含外部依赖时显式拒绝而非静默全量导出", async () => {
      const extDir = mkdtempSync(join(tmpdir(), "ad-filter-composite-"));
      try {
        initProject(extDir, { id: "test.ext-filter-dep", name: "Ext Filter Dep" });
        writeFileSync(
          join(extDir, "actions", "calc.ts"),
          `export default { id: "calc", run: () => 42 };`
        );
        const extCfgPath = join(extDir, "actiondock.json");
        const extCfg = JSON.parse(readFileSync(extCfgPath, "utf-8"));
        extCfg.actions = {
          calc: { entry: "actions/calc.ts", description: "Calc action", uses: [] },
        };
        writeFileSync(extCfgPath, JSON.stringify(extCfg, null, 2), "utf-8");
        await linkPackage(extDir);

        const mainManifestPath = join(tempDir, "actiondock.json");
        const mainManifest = JSON.parse(readFileSync(mainManifestPath, "utf-8"));
        mainManifest.actions["sample.greet"].uses = ["test.ext-filter-dep/calc"];
        writeFileSync(mainManifestPath, JSON.stringify(mainManifest, null, 2), "utf-8");

        // actions 过滤 + 外部依赖闭包：应拒绝
        let errActions: any;
        try {
          await exportSkill({
            projectRoot: tempDir,
            mode: "source",
            actions: ["sample.greet"],
            outDir: join(tempDir, "dist", "filter-composite-a"),
          });
        } catch (err) {
          errActions = err;
        }
        assert.ok(errActions instanceof BuilderError);
        assert.strictEqual(errActions.code, "FILTERS_UNSUPPORTED_FOR_COMPOSITE");

        // playbooks 过滤 + 外部依赖闭包：同样应拒绝
        let errPlaybooks: any;
        try {
          await exportSkill({
            projectRoot: tempDir,
            mode: "source",
            playbooks: ["greet-user"],
            outDir: join(tempDir, "dist", "filter-composite-b"),
          });
        } catch (err) {
          errPlaybooks = err;
        }
        assert.ok(errPlaybooks instanceof BuilderError);
        assert.strictEqual(errPlaybooks.code, "FILTERS_UNSUPPORTED_FOR_COMPOSITE");

        // 不带过滤时仍可正常走复合导出路径
        const okRes = await exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir: join(tempDir, "dist", "filter-composite-ok"),
        });
        assert.strictEqual(existsSync(join(okRes.skillDir, "packages", "builder-fixture")), true);
        assert.strictEqual(existsSync(join(okRes.skillDir, "packages", "ext-filter-dep")), true);
      } finally {
        safeCleanDir(extDir);
      }
    });

    it("复合 SKILL.md 搜索不蔓延至祖父目录：祖父目录的无关 SKILL.md 不被复用", async () => {
      // workspaceRoot 未提供时，搜索目录包含 cwd 与项目根的父目录，绝不包含祖父目录
      const deepBase = mkdtempSync(join(tmpdir(), "ad-grandparent-test-"));
      const projectDir = join(deepBase, "level1", "level2", "my-project");
      try {
        initProject(projectDir, { id: "test.deep-project", name: "Deep Project" });

        // 祖父目录（level1）放置无关全局 SKILL.md
        writeFileSync(
          join(deepBase, "level1", "SKILL.md"),
          "# Unrelated Global Skill\n\nShould not be picked up.",
          "utf-8"
        );

        // 复合导出：项目根为 my-project，父目录 level2、祖父目录 level1
        const res = await exportCompositeSkill({
          bundleName: "deep-bundle",
          projectRoots: [projectDir],
          outDir: join(deepBase, "dist", "deep-bundle"),
        });

        // 产物 SKILL.md 必须是自动生成的复合说明书，而非祖父目录的无关文件
        assert.strictEqual(res.usedExistingSkillMd, undefined);
        const md = readFileSync(join(res.skillDir, "SKILL.md"), "utf-8");
        assert.ok(!(md).includes("Unrelated Global Skill"));
        assert.ok((md).includes("deep-bundle"));
      } finally {
        safeCleanDir(deepBase);
      }
    });

    it("skillMdOnly 覆盖已存在的 SKILL.md 时输出警告", async () => {
      const captured = await captureConsoleWarn(async () => {
        const wsDir = mkdtempSync(join(tmpdir(), "ad-skillmdonly-warn-"));
        try {
          initProject(join(wsDir, "pkg-a"), { id: "test.warn-pkg-a", name: "Warn Pkg A" });
          // 目标位置预先放置旧 SKILL.md
          const outDir = join(wsDir, "out");
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, "SKILL.md"), "# Old Existing\n", "utf-8");

          const result = await exportCompositeSkill({
            bundleName: "warn-bundle",
            projectRoots: [join(wsDir, "pkg-a")],
            outDir,
            skillMdOnly: true,
          });
          assert.strictEqual(result.skillMdFile, join(outDir, "SKILL.md"));
          assert.ok(!(readFileSync(join(outDir, "SKILL.md"), "utf-8")).includes("# Old Existing"));
          return true;
        } finally {
          safeCleanDir(wsDir);
        }
      });
      assert.ok((captured.output).includes("[WARN]"));
      assert.ok((captured.output).includes("overwritten"));
    });
  });

  describe("单一事实源收敛后的行为契约", () => {
    it("单包导出与复合导出的依赖清洗产物一致：file:/workspace:/@actiondock 混合依赖同一结果", async () => {
      const siblingPkgDir = join(tempDir, "packages", "shared-helper");
      mkdirSync(siblingPkgDir, { recursive: true });
      writeFileSync(
        join(siblingPkgDir, "package.json"),
        JSON.stringify({ name: "shared-helper", version: "7.8.9" })
      );
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "sanitize-parity-pkg",
            version: "1.2.3",
            dependencies: {
              "@actiondock/core": "workspace:*",
              "shared-helper": "workspace:*",
              "pinned-dep": "workspace:~3.0.0",
              "plain-dep": "^2.0.0",
            },
            devDependencies: { typescript: "^5.0.0" },
          },
          null,
          2
        )
      );

      // 单包源码导出产物依赖
      const singleRes = await exportSkill({
        projectRoot: tempDir,
        mode: "source",
        outDir: join(tempDir, "dist", "parity-single"),
      });
      const singleDeps = JSON.parse(
        readFileSync(join(singleRes.skillDir, "package.json"), "utf-8")
      ).dependencies;

      // 复合导出产物依赖（聚合链路应产出等价清洗结果）
      const compositeRes = await exportCompositeSkill({
        bundleName: "parity-bundle",
        projectRoots: [tempDir],
        outDir: join(tempDir, "dist", "parity-composite"),
      });
      const compositeDeps = JSON.parse(
        readFileSync(join(compositeRes.skillDir, "package.json"), "utf-8")
      ).dependencies;

      // 两条链路对同一依赖字典的清洗结果必须一致
      assert.deepStrictEqual(Object.keys(singleDeps).sort(), Object.keys(compositeDeps).sort());
      for (const dep of Object.keys(singleDeps)) {
        assert.strictEqual(compositeDeps[dep], singleDeps[dep]);
      }
      assert.strictEqual(singleDeps["shared-helper"], "^7.8.9");
      assert.strictEqual(singleDeps["pinned-dep"], "~3.0.0");
      assert.strictEqual(singleDeps["plain-dep"], "^2.0.0");
      assert.notStrictEqual(singleDeps["@actiondock/sdk"], undefined);
      assert.strictEqual(singleDeps.devDependencies, undefined);
    });

    it("目录名冲突回退后仍同名时追加数字后缀，两个同尾段 ID 包目录互不覆盖", async () => {
      const clashBase = mkdtempSync(join(tmpdir(), "ad-clash-test-"));
      try {
        // 两个同尾段但前缀不同的点号 ID：getPackageSlug 相同，回退值也不同
        initProject(join(clashBase, "a"), { id: "alpha.shared", name: "Alpha Shared" });
        initProject(join(clashBase, "b"), { id: "beta.shared", name: "Beta Shared" });

        // 复合导出保证子包目录互不覆盖
        const compositeRes = await exportCompositeSkill({
          bundleName: "clash-bundle",
          projectRoots: [join(clashBase, "a"), join(clashBase, "b")],
          outDir: join(clashBase, "dist", "composite"),
        });
        const subDirs = readdirSync(join(compositeRes.skillDir, "packages")).sort();
        assert.strictEqual(subDirs.length, 2);
        assert.strictEqual(new Set(subDirs).size, 2);
        for (const sub of subDirs) {
          assert.strictEqual(existsSync(join(compositeRes.skillDir, "packages", sub, "actiondock.json")), true);
        }
      } finally {
        safeCleanDir(clashBase);
      }
    });

    it("损坏的 package.json 使规划报 PlannerError 并携带路径与原因，而非静默空依赖", () => {
      writeFileSync(join(tempDir, "package.json"), "{ this is not valid json !!!");
      let err: any;
      try {
        SelectionPlanner.plan({ projectRoot: tempDir });
      } catch (e) {
        err = e;
      }
      assert.ok(err instanceof PlannerError);
      assert.strictEqual(err.code, "EXTRACT_DEPS_ERROR");
      assert.ok((err.message).includes("package.json"));
    });
  });

  describe("replaceDirAtomic & moveDirAtomic rollback and atomic behavior", () => {
    it("successfully replaces existing target directory and removes backup", async () => {
      const testRoot = mkdtempSync(join(tmpdir(), "replace-test-"));
      try {
        const target = join(testRoot, "target");
        const staging = join(testRoot, "staging");

        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, "old.txt"), "old content", "utf-8");

        mkdirSync(staging, { recursive: true });
        writeFileSync(join(staging, "new.txt"), "new content", "utf-8");

        await replaceDirAtomic(staging, target);

        assert.strictEqual(existsSync(join(target, "new.txt")), true);
        assert.strictEqual(readFileSync(join(target, "new.txt"), "utf-8"), "new content");
        assert.strictEqual(existsSync(join(target, "old.txt")), false);

        // Check no backup directories remain
        const leftoverOld = readdirSync(testRoot).filter((name) => name.includes(".old-"));
        assert.strictEqual(leftoverOld.length, 0);
      } finally {
        safeCleanDir(testRoot);
      }
    });

    it("rolls back to original target directory if staging promotion fails", async () => {
      const testRoot = mkdtempSync(join(tmpdir(), "rollback-test-"));
      try {
        const target = join(testRoot, "target");
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, "preserve.txt"), "must survive rollback", "utf-8");

        const nonExistentStaging = join(testRoot, "does-not-exist");

        // Attempt replaceDirAtomic with non-existent staging:
        // target is backed up, but promotion fails and must roll back
        let failed = false;
        try {
          await replaceDirAtomic(nonExistentStaging, target);
        } catch {
          failed = true;
        }

        assert.strictEqual(failed, true);
        assert.strictEqual(existsSync(target), true);
        assert.strictEqual(existsSync(join(target, "preserve.txt")), true);
        assert.strictEqual(readFileSync(join(target, "preserve.txt"), "utf-8"), "must survive rollback");

        // Ensure backup directory was moved back and cleaned up
        const leftoverOld = readdirSync(testRoot).filter((name) => name.includes(".old-"));
        assert.strictEqual(leftoverOld.length, 0);
      } finally {
        safeCleanDir(testRoot);
      }
    });

    it("creates target directory directly when target does not exist", async () => {
      const testRoot = mkdtempSync(join(tmpdir(), "create-test-"));
      try {
        const target = join(testRoot, "fresh-target");
        const staging = join(testRoot, "staging");

        mkdirSync(staging, { recursive: true });
        writeFileSync(join(staging, "data.json"), JSON.stringify({ ok: true }), "utf-8");

        await replaceDirAtomic(staging, target);

        assert.strictEqual(existsSync(target), true);
        assert.strictEqual(existsSync(join(target, "data.json")), true);
      } finally {
        safeCleanDir(testRoot);
      }
    });
  });
});
