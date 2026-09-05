import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  type ActionDockManifest,
  initProject,
  saveManifest,
} from "@actiondock/core";
import {
  buildPlan,
  BuildPlanner,
  BunCompiler,
  compileBinary,
  CompilerError,
  CompilerValidationError,
  exportSkill,
  PlannerError,
  SkillExporter,
} from "../src";

describe("@actiondock/builder 测试套件", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-builder-test-"));

    // 软链接根 node_modules 保证测试期间依赖解析
    const rootNodeModules = resolve(__dirname, "../../../node_modules");
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
      expect(assetDeps.some((a) => a.path === "actiondock.manifest.json" && a.type === "config")).toBe(true);

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
      };
      saveManifest(tempDir, manifest);

      // 创建两份规程文档
      const pb1Content = `---
id: workflow-main
description: Main workflow SOP
actions:
  - task.main
---
# Main Workflow
`;
      const pb2Content = `---
id: workflow-other
description: Other workflow SOP
actions:
  - task.other
---
# Other Workflow
`;
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
  });

  describe("BunCompiler: 独立二进制编译器", () => {
    it("对不支持的目标平台架构提前校验报错", async () => {
      const invalidTargets = ["linux-x86", "node", "browser", "windows-arm64", "freebsd"];

      for (const target of invalidTargets) {
        let error: any;
        try {
          await BunCompiler.compile({
            entrypoint: join(tempDir, "actions", "greet.ts"),
            outfile: join(tempDir, "dist", "out-bin"),
            target,
          });
        } catch (err) {
          error = err;
        }

        expect(error).toBeDefined();
        expect(error).toBeInstanceOf(CompilerValidationError);
        expect(error.code).toBe("UNSUPPORTED_TARGET");
      }
    });

    it("对不存在的入口文件校验报错", async () => {
      let error: any;
      try {
        await compileBinary({
          entrypoint: join(tempDir, "actions", "non-existent.ts"),
          outfile: join(tempDir, "dist", "bin"),
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(CompilerValidationError);
      expect(error.code).toBe("ENTRYPOINT_NOT_FOUND");
    });

    it("对编译代码语法错误能够规范化报错", async () => {
      const badEntry = join(tempDir, "bad-syntax.ts");
      writeFileSync(badEntry, "const a = ; // syntax error", "utf-8");

      let error: any;
      try {
        await compileBinary({
          entrypoint: badEntry,
          outfile: join(tempDir, "dist", "bad-bin"),
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(CompilerError);
      expect(error.exitCode).not.toBe(0);
      expect(error.code).toBe("SYNTAX_ERROR");
      expect(error.details.length).toBeGreaterThan(0);
    });

    it("成功编译独立可执行二进制并正确传递 minify 与 bytecode 选项", async () => {
      const entryCode = `
console.log(JSON.stringify({ ok: true, message: "Hello From Standalone Binary" }));
process.exit(0);
`;
      const entryPath = join(tempDir, "test-entry.ts");
      writeFileSync(entryPath, entryCode, "utf-8");

      const outfile = join(tempDir, "dist", "my-standalone");
      const res = await compileBinary({
        entrypoint: entryPath,
        outfile,
        minify: true,
        bytecode: true,
        packageId: "test.builder-fixture",
        version: "1.0.0",
        actions: ["sample.greet"],
      });

      expect(existsSync(res.executablePath)).toBe(true);
      expect(res.sizeBytes).toBeGreaterThan(0);
      expect(res.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(res.minify).toBe(true);
      expect(res.bytecode).toBe(true);
      expect(res.metadataPath).toBeDefined();
      expect(existsSync(res.metadataPath!)).toBe(true);

      // 验证生成的元数据内容
      const meta = JSON.parse(readFileSync(res.metadataPath!, "utf-8"));
      expect(meta.packageId).toBe("test.builder-fixture");
      expect(meta.actions).toEqual(["sample.greet"]);
      expect(meta.sha256).toBe(res.sha256);

      // 实际执行编译生成的单文件二进制，验证其可执行性与输出
      const runProc = Bun.spawnSync([res.executablePath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(runProc.exitCode).toBe(0);
      const output = JSON.parse(runProc.stdout.toString().trim());
      expect(output.ok).toBe(true);
      expect(output.message).toBe("Hello From Standalone Binary");
    }, 30000);
  });

  describe("SkillExporter: Agent Skill 导出与归档", () => {
    it("导出包含标准结构的源码型 Skill", async () => {
      // 写入资产文件
      mkdirSync(join(tempDir, "assets", "nested"), { recursive: true });
      writeFileSync(join(tempDir, "assets", "nested", "data.json"), '{"key": "value"}', "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
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

      // 2. 验证 actiondock.skill.json
      const skillJsonPath = join(exportRes.skillDir, "actiondock.skill.json");
      expect(existsSync(skillJsonPath)).toBe(true);
      const skillJson = JSON.parse(readFileSync(skillJsonPath, "utf-8"));
      expect(skillJson.schemaVersion).toBe("2.0.0");
      expect(skillJson.mode).toBe("source");
      expect(skillJson.actions.length).toBe(1);
      expect(skillJson.actions[0].id).toBe("sample.greet");
      expect(skillJson.actions[0].entry).toBe("actions/greet.ts");

      // 3. 验证 actiondock.manifest.json 清单
      const manifestPath = join(exportRes.skillDir, "actiondock.manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const exportedManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(exportedManifest.schemaVersion).toBe(1);
      expect(exportedManifest.actions["sample.greet"]).toBeDefined();

      // 4. 验证 actiondock.json 配置
      const configPath = join(exportRes.skillDir, "actiondock.json");
      expect(existsSync(configPath)).toBe(true);
      const exportedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(exportedConfig.id).toBe("test.builder-fixture");

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

    it("导出独立二进制 Skill 包并验证可执行性", async () => {
      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        actions: {
          "sample.greet": {
            entry: "actions/greet.ts",
            description: "Greet a user with configurable greeting",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      const outDir = join(tempDir, "dist", "exported-standalone-skill");
      const exportRes = await SkillExporter.export({
        projectRoot: tempDir,
        standalone: true,
        outDir,
      });

      expect(exportRes.mode).toBe("standalone");
      expect(existsSync(exportRes.skillDir)).toBe(true);

      const expectedBin = process.platform === "win32" ? "builder-fixture.exe" : "builder-fixture";
      const binPath = join(exportRes.skillDir, "bin", expectedBin);
      expect(existsSync(binPath)).toBe(true);

      // 验证 actiondock.skill.json 指向二进制
      const skillJson = JSON.parse(readFileSync(join(exportRes.skillDir, "actiondock.skill.json"), "utf-8"));
      expect(skillJson.mode).toBe("standalone");
      expect(skillJson.executable).toContain(expectedBin);

      // 直接执行导出的独立二进制
      const runProc = Bun.spawnSync([binPath, "run", "sample.greet", "--input", '{"name": "SkillUser"}'], {
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
    });
  });
});
