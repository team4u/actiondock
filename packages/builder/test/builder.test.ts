import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  type ActionDockManifest,
  ACTION_ID_REGEX,
  initProject,
  linkPackage,
  loadActions,
  saveManifest,
} from "@actiondock/core";
import {
  assertValidManifestActionIds,
  buildPlan,
  BuildPlanner,
  buildProject,
  packProject,
  BuilderError,
  exportSkill,
  exportSkillBatch,
  exportCompositeSkill,
  getInternalDependencyVersion,
  selectionPlan,
  SelectionPlanner,
  serializePlanManifest,
  SkillExporter,
  createTarGzArchive,
  createZipArchive,
  createZipArchiveAsync,
} from "../src";
import {
  readTarGzEntries,
  readTarGzEntryModes,
  readZipEntries,
  readZipEntryModes,
} from "./archive-reader";

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

describe("@actiondock/builder 测试套件", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-builder-test-"));

    // 软链接根 node_modules 保证测试期间依赖解析
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }

    // 初始化基础项目结构
    initProject(tempDir, {
      id: "test.builder-fixture",
      name: "Builder Fixture Package",
      description: "Test fixture for builder test suite",
    });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // 忽略清理异常
        }
      }
    }
  });

  describe("BuildPlanner: 依赖闭包计算与构建规划", () => {
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

      const planner = new BuildPlanner({ projectRoot: tempDir });
      const plan = planner.plan();

      expect(plan.packageId).toBe("test.builder-fixture");
      expect(plan.actions.length).toBe(1);
      expect(plan.actions[0].id).toBe("sample.greet");

      // 验证依赖分类
      expect(plan.dependencies.actions.length).toBe(1);
      expect(plan.dependencies.actions[0].id).toBe("sample.greet");
      expect(plan.dependencies.actions[0].resolvedPath).toBe(join(tempDir, "actions", "greet.ts"));

      // 验证模块与资产依赖
      const assetDeps = plan.dependencies.modulesAndAssets;
      expect(assetDeps.some((a) => a.path === "assets/template.txt" && a.type === "asset")).toBe(true);
      expect(assetDeps.some((a) => a.path === "actiondock.json" && a.type === "config")).toBe(true);

      // 验证外部依赖解析
      expect(Array.isArray(plan.dependencies.external)).toBe(true);
      expect(plan.dependencies.external.some((d) => d.name === "@actiondock/sdk")).toBe(true);
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
      const plan = buildPlan({
        projectRoot: tempDir,
        actions: ["sample.bomb"],
      });

      expect(plan.actions.length).toBe(1);
      expect(plan.actions[0].id).toBe("sample.bomb");
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
      const plan = buildPlan({
        projectRoot: tempDir,
        actions: ["action.a"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      expect(actionIds).toContain("action.a");
      expect(actionIds).toContain("action.b");
      expect(actionIds).toContain("action.c");
      expect(actionIds).not.toContain("action.isolated");
      expect(plan.actions.length).toBe(3);
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

      const plan = buildPlan({
        projectRoot: tempDir,
        actions: ["loop.a"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      expect(actionIds).toContain("loop.a");
      expect(actionIds).toContain("loop.b");
      expect(plan.actions.length).toBe(2);
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
      const plan = buildPlan({
        projectRoot: tempDir,
        playbooks: ["workflow-main"],
      });

      const actionIds = plan.actions.map((a) => a.id);
      expect(actionIds).toContain("task.main");
      expect(actionIds).toContain("task.helper");
      expect(actionIds).not.toContain("task.other");
      expect(plan.actions.length).toBe(2);

      const pbIds = plan.playbooks.map((p) => p.id);
      expect(pbIds).toEqual(["workflow-main"]);
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

      expect(() => {
        buildPlan({
          projectRoot: tempDir,
          actions: ["broken.action"],
        });
      }).toThrowError(/missing\.dependency/);
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
  run: async () => ({ message: "hello" }),
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
      const selectivePlan = selectionPlan({
        projectRoot: tempDir,
        actions: ["sample.custom-greet"],
        files: ["lib/format.ts", "lib/utils/sanitize.ts"],
      });

      const selectiveModules = selectivePlan.dependencies.modulesAndAssets.filter((d) => d.type === "module");
      const selectivePaths = selectiveModules.map((m) => m.path.replace(/\\/g, "/"));
      expect(selectivePaths).toContain("lib/format.ts");
      expect(selectivePaths).toContain("lib/utils/sanitize.ts");
      expect(selectivePaths).not.toContain("lib/unused.ts");

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
      expect(dirPaths).toContain("lib/format.ts");
      expect(dirPaths).toContain("lib/utils/sanitize.ts");
      expect(dirPaths).toContain("lib/unused.ts");
    });

    it("支持锁文件探测、SHA-256 摘要计算及指纹一致性校验", () => {
      const lockContent = JSON.stringify({ name: "test", lockfileVersion: 3 });
      writeFileSync(join(tempDir, "package-lock.json"), lockContent, "utf-8");

      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
      });

      expect(plan.lockfile).toBeDefined();
      expect(plan.lockfile?.name).toBe("package-lock.json");
      expect(plan.lockfile?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(plan.metadata.lockfileDigest).toBe(plan.lockfile?.sha256);

      // 验证校验失败场景：期望摘要不匹配抛错
      expect(() => {
        SelectionPlanner.plan({
          projectRoot: tempDir,
          expectedLockfileDigest: "invalid-digest-value",
        });
      }).toThrowError(/Lockfile digest mismatch/);
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
        expect(actionIds).toContain("root.caller");
        expect(actionIds).toContain("test.closure-dep/dep-action");
      } finally {
        rmSync(extDir, { recursive: true, force: true });
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
        const plan = buildPlan({ projectRoot: tempDir });

        const assetDeps = plan.dependencies.modulesAndAssets.filter((d) => d.type === "asset");
        const assetPaths = assetDeps.map((d) => d.path.replace(/\\/g, "/"));

        // 内部资产应被纳入
        expect(assetPaths).toContain("assets/local-asset.txt");
        // 逃逸外部的软链接应被忽略并跳过
        expect(assetPaths).not.toContain("assets/escaped-link.txt");
      } finally {
        rmSync(externalDir, { recursive: true, force: true });
      }
    });
  });

  describe("buildProject: Node.js 目录型交付产物生成", () => {
    it("传入 target 或 bytecode 时必须抛出带有 UNSUPPORTED_BUILD_MODE 的 BuilderError", async () => {
      let errorTarget: any;
      try {
        await buildProject({
          projectRoot: tempDir,
          target: "linux-x64",
        });
      } catch (err) {
        errorTarget = err;
      }
      expect(errorTarget).toBeInstanceOf(BuilderError);
      expect(errorTarget.code).toBe("UNSUPPORTED_BUILD_MODE");

      let errorBytecode: any;
      try {
        await buildProject({
          projectRoot: tempDir,
          bytecode: true,
        });
      } catch (err) {
        errorBytecode = err;
      }
      expect(errorBytecode).toBeInstanceOf(BuilderError);
      expect(errorBytecode.code).toBe("UNSUPPORTED_BUILD_MODE");
    });

    it("成功构建 Node.js 目录交付产物并生成可执行启动入口与元数据", async () => {
      const buildRes = await buildProject({
        projectRoot: tempDir,
      });

      expect(existsSync(buildRes.outputDir)).toBe(true);
      expect(existsSync(buildRes.entrypointPath)).toBe(true);
      expect(existsSync(buildRes.metadataPath)).toBe(true);
      expect(existsSync(join(buildRes.outputDir, "actiondock.json"))).toBe(true);
      expect(existsSync(join(buildRes.outputDir, "actiondock.manifest.json"))).toBe(false);
      expect(existsSync(join(buildRes.outputDir, "package.json"))).toBe(true);
      expect(buildRes.reproducible).toBe(true);

      const metadata = JSON.parse(readFileSync(buildRes.metadataPath, "utf-8"));
      expect(metadata.packageId).toBe("test.builder-fixture");
      expect(metadata.actions).toEqual(["sample.greet"]);

      // 执行生成的启动入口测试 list 与 describe
      const listProc = Bun.spawnSync([buildRes.entrypointPath, "list", "--json"], {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(listProc.exitCode).toBe(0);
      const listJson = JSON.parse(listProc.stdout.toString());
      expect(listJson.length).toBe(1);
      expect(listJson[0].id).toBe("sample.greet");
    });

    it("支持 options.archive 生成标准 zip 压缩归档交付产物", async () => {
      const buildRes = await buildProject({
        projectRoot: tempDir,
        archive: true,
      });

      expect(buildRes.archivePath).toBeDefined();
      expect(existsSync(buildRes.archivePath!)).toBe(true);
      expect(buildRes.archivePath!.endsWith(".zip")).toBe(true);
      const stat = statSync(buildRes.archivePath!);
      expect(stat.size).toBeGreaterThan(0);
    });

    it("支持 options.vendorDeps 在干净暂存目录中物化依赖", async () => {
      const buildRes = await buildProject({
        projectRoot: tempDir,
        vendorDeps: true,
      });

      expect(buildRes.vendorDeps).toBe(true);
      expect(existsSync(join(buildRes.outputDir, "node_modules"))).toBe(true);
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

      expect(error).toBeInstanceOf(BuilderError);
      expect(error.code).toBe("REPRODUCIBLE_BUILD_VIOLATION");
    });
  });

  describe("packProject: npm Action 包打包", () => {
    it("支持 dry-run 模式进行预检与清单生成而不生成最终压缩包", async () => {
      const dryResult = await packProject({
        projectRoot: tempDir,
        dryRun: true,
      });

      expect(dryResult.packageId).toBe("test.builder-fixture");
      expect(dryResult.manifestSummary.actionsCount).toBe(1);
      expect(dryResult.manifestSummary.actions).toContain("sample.greet");
      expect(dryResult.tarballPath).toBeUndefined();
    });

    it("将 TypeScript Action 项目打包为标准 tgz 压缩包且不修改源工程", async () => {
      const sourcePkgJson = readFileSync(join(tempDir, "package.json"), "utf-8");
      const sourceGreetCode = readFileSync(join(tempDir, "actions", "greet.ts"), "utf-8");

      const packResult = await packProject({
        projectRoot: tempDir,
      });

      expect(packResult.tarballPath).toBeDefined();
      expect(existsSync(packResult.tarballPath!)).toBe(true);
      expect(packResult.tarballName.endsWith(".tgz")).toBe(true);
      expect(packResult.sizeBytes).toBeGreaterThan(0);
      expect(packResult.sha256).toMatch(/^[a-f0-9]{64}$/);

      // 验证源工程文件未被改写
      expect(readFileSync(join(tempDir, "package.json"), "utf-8")).toBe(sourcePkgJson);
      expect(readFileSync(join(tempDir, "actions", "greet.ts"), "utf-8")).toBe(sourceGreetCode);
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

      expect(exportRes.mode).toBe("source");
      expect(exportRes.actionsCount).toBe(1);
      expect(exportRes.playbooksCount).toBe(1);
      expect(existsSync(exportRes.skillDir)).toBe(true);

      // 1. 验证 SKILL.md
      const skillMdPath = join(exportRes.skillDir, "SKILL.md");
      expect(existsSync(skillMdPath)).toBe(true);
      const skillMd = readFileSync(skillMdPath, "utf-8");
      expect(skillMd.startsWith("---\nname:")).toBe(true);
      expect(skillMd).toContain("sample.greet");

      // 2. 验证已废弃且不再生成 actiondock.skill.json
      const skillJsonPath = join(exportRes.skillDir, "actiondock.skill.json");
      expect(existsSync(skillJsonPath)).toBe(false);

      // 3. 验证不再生成已废弃的 actiondock.manifest.json 清单
      const manifestPath = join(exportRes.skillDir, "actiondock.manifest.json");
      expect(existsSync(manifestPath)).toBe(false);

      // 4. 验证 actiondock.json 配置（单一事实源）
      const configPath = join(exportRes.skillDir, "actiondock.json");
      expect(existsSync(configPath)).toBe(true);
      const exportedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(exportedConfig.id).toBe("test.builder-fixture");
      expect(exportedConfig.schemaVersion).toBe(2);
      expect(exportedConfig.actions["sample.greet"]).toBeDefined();

      // 5. 验证 package.json
      const pkgPath = join(exportRes.skillDir, "package.json");
      expect(existsSync(pkgPath)).toBe(true);

      // 6. 验证保留相对路径的 Action 源码
      const actionSrcPath = join(exportRes.skillDir, "actions", "greet.ts");
      expect(existsSync(actionSrcPath)).toBe(true);

      // 7. 验证保留相对路径的资产文件
      const assetPath = join(exportRes.skillDir, "assets", "nested", "data.json");
      expect(existsSync(assetPath)).toBe(true);
      expect(readFileSync(assetPath, "utf-8")).toBe('{"key": "value"}');

      // 8. 验证 Playbook 文件
      const pbPath = join(exportRes.skillDir, "playbooks", "greet-user.md");
      expect(existsSync(pbPath)).toBe(true);
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
      expect(existsSync(exportedPkgPath)).toBe(true);

      const exportedPkg = JSON.parse(readFileSync(exportedPkgPath, "utf-8"));

      // @actiondock/* workspace:* resolves to internal dependency version
      expect(exportedPkg.dependencies["@actiondock/core"]).toBeDefined();
      expect(exportedPkg.dependencies["@actiondock/sdk"]).toBeDefined();

      // Non-actiondock workspace:* resolves to actual package version
      expect(exportedPkg.dependencies["custom-helper"]).toBe("^3.4.5");

      // Explicit workspace constraint is stripped cleanly
      expect(exportedPkg.dependencies["explicit-dep"]).toBe("^2.1.0");

      // Normal dependencies are preserved
      expect(exportedPkg.dependencies["external-dep"]).toBe("^1.0.0");

      // devDependencies are omitted entirely
      expect(exportedPkg.devDependencies).toBeUndefined();
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
      await expect(
        exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir,
        })
      ).rejects.toThrow(BuilderError);
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
      await expect(
        exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir,
        })
      ).rejects.toThrow(BuilderError);
    });

    it("getInternalDependencyVersion 正确对齐预发布版本与正式版本", () => {
      // 预发布版本对齐为精确版本
      expect(getInternalDependencyVersion("2.0.0-beta.1")).toBe("2.0.0-beta.1");
      expect(getInternalDependencyVersion("2.0.0-rc.3")).toBe("2.0.0-rc.3");
      // 正式发布版本采用 ^ 语义范围
      expect(getInternalDependencyVersion("2.0.0")).toBe("^2.0.0");
      expect(getInternalDependencyVersion("2.1.3")).toBe("^2.1.3");
    });

    it("传入 standalone 模式时严格拒绝并抛出提示替代方案的 BuilderError", async () => {
      let error: any;
      try {
        await SkillExporter.export({
          projectRoot: tempDir,
          standalone: true,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(BuilderError);
      expect(error.code).toBe("UNSUPPORTED_BUILD_MODE");
      expect(error.message).toContain("--mode node");
    });

    it("导出 Node 目录型 Skill 包并验证可执行性", async () => {
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
      const exportRes = await SkillExporter.export({
        projectRoot: tempDir,
        mode: "node",
        outDir,
      });

      expect(exportRes.mode).toBe("node");
      expect(existsSync(exportRes.skillDir)).toBe(true);

      const entryPath = join(exportRes.skillDir, "entry.mjs");
      expect(existsSync(entryPath)).toBe(true);

      // 验证生成的 SKILL.md 包含 node 执行说明
      const skillMd = readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("node ./entry.mjs");

      // 直接执行导出的 Node 入口
      const runProc = Bun.spawnSync([entryPath, "run", "sample.greet", "--input", '{"name": "SkillUser"}'], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(runProc.exitCode).toBe(0);
      const res = JSON.parse(runProc.stdout.toString().trim());
      expect(res.ok).toBe(true);
      expect(res.data.message).toBe("Hello, SkillUser!");
    }, 35000);

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
      expect(zipRes.archivePath).toBeDefined();
      expect(zipRes.archivePath!.endsWith(".zip")).toBe(true);
      expect(existsSync(zipRes.archivePath!)).toBe(true);

      // 2. 验证 tar.gz 归档
      const tarRes = await exportSkill({
        projectRoot: tempDir,
        outDir: join(tempDir, "dist", "skill-for-tar"),
        archive: "tar.gz",
      });
      expect(tarRes.archivePath).toBeDefined();
      expect(tarRes.archivePath!.endsWith(".tar.gz")).toBe(true);
      expect(existsSync(tarRes.archivePath!)).toBe(true);

      // 3. 纯代码解包两种归档，与各自导出目录逐文件比对内容（不依赖外部解压命令）
      const zipExpected = collectFiles(zipRes.skillDir);
      expect(zipExpected.size).toBeGreaterThan(0);

      const zipEntries = readZipEntries(zipRes.archivePath!);
      // zip 含目录条目，文件条目数应与源一致
      const zipFiles = [...zipEntries].filter(([, v]) => v !== null);
      expect(zipFiles.length).toBe(zipExpected.size);
      for (const [relPath, content] of zipExpected) {
        const archived = zipEntries.get(relPath);
        expect(archived).toBeDefined();
        expect(archived!.equals(content)).toBe(true);
      }

      const tarExpected = collectFiles(tarRes.skillDir);
      expect(tarExpected.size).toBe(zipExpected.size);
      const tarEntries = readTarGzEntries(tarRes.archivePath!);
      // tar 条目包含目录行，文件条目逐项比对
      for (const [relPath, content] of tarExpected) {
        const archived = tarEntries.get(relPath);
        expect(archived).toBeDefined();
        expect(archived!.equals(content)).toBe(true);
      }
    });

    it("打包归档时正确识别并保留可执行文件与 bin 目录权限位 (zip 与 tar.gz)", () => {
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

        createZipArchive(archiveTestDir, zipOut);
        createTarGzArchive(archiveTestDir, tarOut);

        const rootName = basename(archiveTestDir);

        // 验证 zip 权限位
        const zipModes = readZipEntryModes(zipOut);
        expect(zipModes.get(`${rootName}/bin/run.sh`)).toBe(0o100755);
        expect(zipModes.get(`${rootName}/readme.txt`)).toBe(0o100644);
        expect(zipModes.get(`${rootName}/bin`)).toBe(0o40755);

        // 验证 tar.gz 权限位
        const tarModes = readTarGzEntryModes(tarOut);
        expect(tarModes.get(`${rootName}/bin/run.sh`)).toBe(0o755);
        expect(tarModes.get(`${rootName}/readme.txt`)).toBe(0o644);
        expect(tarModes.get(`${rootName}/bin`)).toBe(0o755);
      } finally {
        rmSync(archiveTestDir, { recursive: true, force: true });
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

        expect(existsSync(zipOut)).toBe(true);
        const rootName = basename(archiveTestDir);

        // 解包并验证内容一致性
        const zipEntries = readZipEntries(zipOut);
        expect(zipEntries.get(`${rootName}/empty.txt`)?.length).toBe(0);
        expect(zipEntries.get(`${rootName}/readme.txt`)?.toString("utf8")).toBe("Hello Streaming Zip Archive\n");
        expect(zipEntries.get(`${rootName}/bin/run.sh`)?.toString("utf8")).toBe("#!/bin/sh\necho streamed-ok\n");
        const readLarge = zipEntries.get(`${rootName}/subdir/large.dat`);
        expect(readLarge).toBeDefined();
        expect(readLarge!.equals(largeContent)).toBe(true);

        // 验证权限位
        const zipModes = readZipEntryModes(zipOut);
        expect(zipModes.get(`${rootName}/bin/run.sh`)).toBe(0o100755);
        expect(zipModes.get(`${rootName}/readme.txt`)).toBe(0o100644);
        expect(zipModes.get(`${rootName}/bin`)).toBe(0o40755);

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
        expect(eocd).toBeGreaterThan(0);

        const entryCount = zipBuf.readUInt16LE(eocd + 10);
        let ptr = zipBuf.readUInt32LE(eocd + 16);

        for (let i = 0; i < entryCount; i++) {
          expect(zipBuf.readUInt32LE(ptr)).toBe(0x02014b50);
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
          expect(zipBuf.readUInt32LE(localOffset)).toBe(0x04034b50);
          const localFlag = zipBuf.readUInt16LE(localOffset + 6);
          const localMethod = zipBuf.readUInt16LE(localOffset + 8);
          const localCrc = zipBuf.readUInt32LE(localOffset + 14);
          const localComp = zipBuf.readUInt32LE(localOffset + 18);
          const localUncomp = zipBuf.readUInt32LE(localOffset + 22);

          if (entryName.endsWith("/") || entryName.endsWith("empty.txt")) {
            // 目录与空文件：Stored 模式，无需 Data Descriptor
            expect(localFlag).toBe(0x0800);
            expect(localMethod).toBe(0);
            expect(localCrc).toBe(0);
            expect(localComp).toBe(0);
            expect(localUncomp).toBe(0);
          } else {
            // 非空文件：Deflate 模式且启用 bit 3 Data Descriptor
            expect(localFlag).toBe(0x0808);
            expect(flag).toBe(0x0808);
            expect(localMethod).toBe(8);
            expect(method).toBe(8);
            // Local Header 中的 crc/尺寸字段置 0
            expect(localCrc).toBe(0);
            expect(localComp).toBe(0);
            expect(localUncomp).toBe(0);
            // Central Directory 中必须记录真实值
            expect(crc).toBeGreaterThan(0);
            expect(compSize).toBeGreaterThan(0);
            expect(uncompSize).toBeGreaterThan(0);

            // 紧随压缩数据之后存在 16 字节 Data Descriptor
            const localNameLen = zipBuf.readUInt16LE(localOffset + 26);
            const localExtraLen = zipBuf.readUInt16LE(localOffset + 28);
            const ddOffset = localOffset + 30 + localNameLen + localExtraLen + compSize;

            expect(zipBuf.readUInt32LE(ddOffset)).toBe(0x08074b50); // 签名
            expect(zipBuf.readUInt32LE(ddOffset + 4)).toBe(crc); // CRC32
            expect(zipBuf.readUInt32LE(ddOffset + 8)).toBe(compSize); // 压缩尺寸
            expect(zipBuf.readUInt32LE(ddOffset + 12)).toBe(uncompSize); // 原始尺寸
          }

          ptr += 46 + nameLen + extraLen + commentLen;
        }
      } finally {
        rmSync(archiveTestDir, { recursive: true, force: true });
      }
    });

    it("支持批量导出多个 Skill 包 (exportSkillBatch)", async () => {
      const pkg2Dir = mkdtempSync(join(tmpdir(), "ad-builder-test-pkg2-"));
      try {
        initProject(pkg2Dir, {
          id: "test.second-package",
          name: "Second Package",
          description: "Second test package",
        });

        const batchRes = await exportSkillBatch({
          projectRoots: [tempDir, pkg2Dir],
          outDir: join(tempDir, "dist", "batch-skills"),
        });

        expect(batchRes.results.length).toBe(2);
        expect(batchRes.results[0].packageId).toBe("test.builder-fixture");
        expect(batchRes.results[1].packageId).toBe("test.second-package");

        expect(existsSync(join(batchRes.outDir, "builder-fixture-skill", "SKILL.md"))).toBe(true);
        expect(existsSync(join(batchRes.outDir, "second-package-skill", "SKILL.md"))).toBe(true);
        expect(existsSync(join(batchRes.outDir, "builder-fixture-skill", "actiondock.skill.json"))).toBe(false);
      } finally {
        rmSync(pkg2Dir, { recursive: true, force: true });
      }
    });

    it("批量与复合导出拒绝空项目列表", async () => {
      await expect(exportSkillBatch({ projectRoots: [] })).rejects.toThrow(BuilderError);
      await expect(exportCompositeSkill({ bundleName: "empty-suite", projectRoots: [] })).rejects.toThrow(BuilderError);
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

        expect(compositeRes.bundleName).toBe("test-composite-suite");
        expect(compositeRes.packagesCount).toBe(2);
        expect(compositeRes.playbooksCount).toBeGreaterThanOrEqual(1);
        expect(existsSync(join(compositeRes.skillDir, "SKILL.md"))).toBe(true);
        expect(existsSync(join(compositeRes.skillDir, "actiondock.skill.json"))).toBe(false);
        expect(existsSync(join(compositeRes.skillDir, "packages", "builder-fixture"))).toBe(true);
        expect(existsSync(join(compositeRes.skillDir, "packages", "second-package"))).toBe(true);
        // 验证子包原位保留代码但不再包含独立的 SKILL.md，对外保持单一 Skill 入口
        expect(existsSync(join(compositeRes.skillDir, "packages", "builder-fixture", "SKILL.md"))).toBe(false);
        expect(existsSync(join(compositeRes.skillDir, "packages", "second-package", "SKILL.md"))).toBe(false);

        // 验证物理 Playbook 文件与 SKILL.md 相对路径严格一致
        const expectedPbPath = join(compositeRes.skillDir, "packages", "second-package", "playbooks", "deploy.md");
        expect(existsSync(expectedPbPath)).toBe(true);

        const skillMd = readFileSync(join(compositeRes.skillDir, "SKILL.md"), "utf-8");
        expect(skillMd).toContain("test-composite-suite");
        expect(skillMd).toContain("test.builder-fixture");
        expect(skillMd).toContain("test.second-package");
        expect(skillMd).toContain("packages/second-package/playbooks/deploy.md");
        expect(skillMd).toContain("ad link");
        expect(skillMd).toContain("故障排查与环境安装指引");
        expect(skillMd).toContain("npm install --omit=dev");

        // 验证归档产物
        expect(compositeRes.archivePath).toBeDefined();
        expect(existsSync(compositeRes.archivePath!)).toBe(true);
      } finally {
        rmSync(pkg2Dir, { recursive: true, force: true });
      }
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

        expect(res.usedExistingSkillMd).toBe(customSkillPath);
        expect(existsSync(join(res.skillDir, "SKILL.md"))).toBe(true);
        const copiedContent = readFileSync(join(res.skillDir, "SKILL.md"), "utf-8");
        expect(copiedContent).toBe(customSkillContent);
      } finally {
        rmSync(customSkillPath, { force: true });
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

        expect(res.usedExistingSkillMd).toBe(join(wsSkillDir, "SKILL.md"));
        expect(existsSync(join(res.skillDir, "SKILL.md"))).toBe(true);
        const copiedContent = readFileSync(join(res.skillDir, "SKILL.md"), "utf-8");
        expect(copiedContent).toBe(customSkillContent);
        // 内部子包不生成 SKILL.md
        expect(existsSync(join(res.skillDir, "packages", "pkg-a", "SKILL.md"))).toBe(false);
        expect(existsSync(join(res.skillDir, "packages", "pkg-b", "SKILL.md"))).toBe(false);
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    it("resolves external linked action in BuildPlanner when linked package has default actiondock.json", async () => {
      const extDir = mkdtempSync(join(tmpdir(), "ext-pkg-"));
      try {
        initProject(extDir, { id: "test.ext-tools", name: "External Tools" });
        writeFileSync(
          join(extDir, "actions", "calc.ts"),
          `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "calc", uses: [], run: () => 42 });`
        );
        await linkPackage(extDir);

        const planner = new BuildPlanner({ projectRoot: tempDir });
        const plan = planner.plan({
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

        expect(plan.actions.some((a) => a.id === "test.ext-tools/calc")).toBe(true);
      } finally {
        rmSync(extDir, { recursive: true, force: true });
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

        const planner = new BuildPlanner({ projectRoot: customDir });
        const plan = planner.plan({ projectRoot: customDir });
        expect(plan.actionsDir).toBe("src/my-actions");
        expect(plan.playbooksDir).toBe("docs/my-playbooks");

        const outDir = join(customDir, "dist", "exported");
        const expResult = await exportSkill({
          projectRoot: customDir,
          outDir,
        });
        expect(expResult.skillDir).toBe(outDir);

        const exportedConfig = JSON.parse(readFileSync(join(outDir, "actiondock.json"), "utf-8"));
        expect(exportedConfig.actionsDir).toBe("src/my-actions");
        expect(exportedConfig.playbooksDir).toBe("docs/my-playbooks");
        expect(existsSync(join(outDir, "docs", "my-playbooks", "guide.md"))).toBe(true);

        const exportedSkillMd = readFileSync(join(outDir, "SKILL.md"), "utf-8");
        expect(exportedSkillMd).toContain("./docs/my-playbooks/guide.md");
      } finally {
        rmSync(customDir, { recursive: true, force: true });
      }
    });

    it("creates valid USTAR tar.gz archives with long directory and file paths (>100 chars)", () => {
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

        createTarGzArchive(archiveDir, outTarGz);
        expect(existsSync(outTarGz)).toBe(true);

        const entries = readTarGzEntries(outTarGz);
        const keys = Array.from(entries.keys());
        const dirKey = keys.find((k) => k.includes("third_long_nested_directory_level_3"));
        expect(dirKey).toBeDefined();
        // Dir entry path in tar header ends with / or is registered as directory
        expect(dirKey!.length).toBeGreaterThan(100);
        expect(entries.get(dirKey!)).toBeNull();

        const fileKey = keys.find((k) => k.endsWith("sample.txt"));
        expect(fileKey).toBeDefined();
        expect(entries.get(fileKey!)?.toString("utf-8")).toBe("hello long path");
      } finally {
        rmSync(archiveDir, { recursive: true, force: true });
      }
    });

    it("在写入端强制自检：assertValidManifestActionIds 拦截不符合规范的 Action ID", () => {
      // 合法 ID 校验通过
      expect(() => {
        assertValidManifestActionIds({
          "sample.greet": { entry: "actions/greet.ts" },
          "valid_action-123": { entry: "actions/valid.ts" },
        });
      }).not.toThrow();

      // 拦截包含命名空间分隔符 / 的 Action ID
      expect(() => {
        assertValidManifestActionIds({
          "test.ext-tools/calc": { entry: "actions/calc.ts" },
        });
      }).toThrow(BuilderError);

      // 拦截包含大写字母与非法符号的 Action ID
      expect(() => {
        assertValidManifestActionIds({
          "Invalid_Upper": { entry: "actions/test.ts" },
        });
      }).toThrow(BuilderError);
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

        expect(compositeRes.packagesCount).toBe(2);
        const exportedPkgsDir = join(bundleOut, "packages");
        expect(existsSync(exportedPkgsDir)).toBe(true);

        const subpkgs = readdirSync(exportedPkgsDir);
        expect(subpkgs).toContain("builder-fixture");
        expect(subpkgs).toContain("ext-tools");

        // 验证主包清单只包含自有 Action，跨包依赖不写入主包清单
        const mainExportedManifest = JSON.parse(
          readFileSync(join(exportedPkgsDir, "builder-fixture", "actiondock.json"), "utf-8")
        );
        expect(Object.keys(mainExportedManifest.actions)).toEqual(["sample.greet"]);
        expect(mainExportedManifest.actions["test.ext-tools/calc"]).toBeUndefined();
        expect(mainExportedManifest.actions["calc"]).toBeUndefined();

        // 验证跨包依赖不物化进消费包目录
        expect(existsSync(join(exportedPkgsDir, "builder-fixture", "actions", "greet.ts"))).toBe(true);
        expect(existsSync(join(exportedPkgsDir, "builder-fixture", "actions", "calc.ts"))).toBe(false);

        // 验证外部依赖包整包完整保留
        const extExportedManifest = JSON.parse(
          readFileSync(join(exportedPkgsDir, "ext-tools", "actiondock.json"), "utf-8")
        );
        expect(Object.keys(extExportedManifest.actions)).toEqual(["calc"]);
        expect(existsSync(join(exportedPkgsDir, "ext-tools", "actions", "calc.ts"))).toBe(true);

        // 往返测试断言：对每个导出包执行 loadActions，必须零错误
        for (const subpkg of subpkgs) {
          const subpkgDir = join(exportedPkgsDir, subpkg);
          const loaded = await loadActions(subpkgDir);
          expect(loaded.size).toBeGreaterThan(0);
          for (const [id] of loaded) {
            expect(ACTION_ID_REGEX.test(id)).toBe(true);
          }
        }

        // 2. 测试单包源码导出：如果依赖闭包含外部包，导成 mini-workspace 形态
        const singleOut = join(tempDir, "dist", "roundtrip-single-ws");
        const singleRes = await exportSkill({
          projectRoot: tempDir,
          mode: "source",
          outDir: singleOut,
        });

        expect(existsSync(join(singleOut, "packages", "builder-fixture"))).toBe(true);
        expect(existsSync(join(singleOut, "packages", "ext-tools"))).toBe(true);

        // 对 mini-workspace 下的每个包执行 loadActions，零错误
        const singleSubpkgs = readdirSync(join(singleOut, "packages"));
        for (const subpkg of singleSubpkgs) {
          const subpkgDir = join(singleOut, "packages", subpkg);
          const loaded = await loadActions(subpkgDir);
          expect(loaded.size).toBeGreaterThan(0);
          for (const [id] of loaded) {
            expect(ACTION_ID_REGEX.test(id)).toBe(true);
          }
        }
      } finally {
        rmSync(extDir, { recursive: true, force: true });
      }
    });
  });
});
