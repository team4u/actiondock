import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
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
  initProject,
  linkPackage,
  saveManifest,
} from "@actiondock/core";
import {
  buildPlan,
  BuildPlanner,
  BunCompiler,
  BuilderError,
  compileBinary,
  CompilerError,
  CompilerValidationError,
  exportSkill,
  exportSkillBatch,
  exportCompositeSkill,
  PlannerError,
  SkillExporter,
  createTarGzArchive,
  createZipArchive,
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

    it("静态解析 Action 源码引用的本地模块闭包（lib 与辅助文件）并正确标记为 module", () => {
      // 创建 lib 源码目录与多级依赖
      mkdirSync(join(tempDir, "lib", "utils"), { recursive: true });
      writeFileSync(join(tempDir, "lib", "utils", "sanitize.ts"), "export const sanitize = (s: string) => s.trim();", "utf-8");
      writeFileSync(
        join(tempDir, "lib", "format.ts"),
        'import { sanitize } from "./utils/sanitize.js";\nexport const format = (s: string) => sanitize(s).toUpperCase();',
        "utf-8"
      );
      // 未被引用的额外 lib 文件
      writeFileSync(join(tempDir, "lib", "unused.ts"), "export const unused = 42;", "utf-8");

      // Action 源码显式引用 lib/format.js
      const actionWithLibCode = `
import { defineAction } from "@actiondock/sdk";
import { format } from "../lib/format.js";

export default defineAction({
  id: "sample.custom-greet",
  description: "Greet using helper",
  run: async (input: { name: string }) => ({ message: format(input.name) }),
});
`;
      writeFileSync(join(tempDir, "actions", "custom-greet.ts"), actionWithLibCode, "utf-8");

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        actions: {
          "sample.custom-greet": {
            entry: "actions/custom-greet.ts",
            description: "Greet using helper",
            uses: [],
          },
        },
      };
      saveManifest(tempDir, manifest);

      // 1. 按需选择 Action 规划：仅闭包内的 lib/format.ts 与 lib/utils/sanitize.ts 应当被收集，unused.ts 不在其中
      const selectivePlan = buildPlan({
        projectRoot: tempDir,
        actions: ["sample.custom-greet"],
      });

      const selectiveModules = selectivePlan.dependencies.modulesAndAssets.filter((d) => d.type === "module");
      const selectivePaths = selectiveModules.map((m) => m.path);
      expect(selectivePaths).toContain("lib/format.ts");
      expect(selectivePaths).toContain("lib/utils/sanitize.ts");
      expect(selectivePaths).not.toContain("lib/unused.ts");

      // 2. 全量包构建规划：lib 下全部有效源码（含 unused.ts）均被纳入
      const fullPlan = buildPlan({
        projectRoot: tempDir,
      });

      const fullModules = fullPlan.dependencies.modulesAndAssets.filter((d) => d.type === "module");
      const fullPaths = fullModules.map((m) => m.path);
      expect(fullPaths).toContain("lib/format.ts");
      expect(fullPaths).toContain("lib/utils/sanitize.ts");
      expect(fullPaths).toContain("lib/unused.ts");
    });

    it("基于 AST 解析并支持 tsconfig.json 路径别名 (@/*) 本地模块解析", () => {
      writeFileSync(
        join(tempDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["src/*"],
            },
          },
        }),
        "utf-8"
      );

      mkdirSync(join(tempDir, "src", "helpers"), { recursive: true });
      writeFileSync(join(tempDir, "src", "helpers", "calc.ts"), "export const add = (a: number, b: number) => a + b;", "utf-8");

      const actionFile = join(tempDir, "actions", "alias-action.ts");
      writeFileSync(
        actionFile,
        `import { add } from "@/helpers/calc";\nexport default { id: "sample.alias-action", run: () => add(1, 2) };`,
        "utf-8"
      );

      const manifest: ActionDockManifest = {
        schemaVersion: 1,
        actions: {
          "sample.alias-action": {
            entry: "actions/alias-action.ts",
            description: "Alias test action",
          },
        },
      };
      saveManifest(tempDir, manifest);

      const plan = buildPlan({
        projectRoot: tempDir,
        actions: ["sample.alias-action"],
      });

      const modules = plan.dependencies.modulesAndAssets.filter((d) => d.type === "module");
      const paths = modules.map((m) => m.path.replace(/\\/g, "/"));
      expect(paths).toContain("src/helpers/calc.ts");
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

      // 2. 验证已废弃且不再生成 actiondock.skill.json
      const skillJsonPath = join(exportRes.skillDir, "actiondock.skill.json");
      expect(existsSync(skillJsonPath)).toBe(false);

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
              "file-dep": "file:../local-folder",
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

      // 1. @actiondock/* workspace:* resolves to ^ACTIONDOCK_VERSION
      expect(exportedPkg.dependencies["@actiondock/core"]).toMatch(/^\^2\./);
      expect(exportedPkg.dependencies["@actiondock/sdk"]).toMatch(/^\^2\./);

      // 2. Non-actiondock workspace:* resolves to actual package version
      expect(exportedPkg.dependencies["custom-helper"]).toBe("^3.4.5");

      // 3. Explicit workspace constraint is stripped cleanly
      expect(exportedPkg.dependencies["explicit-dep"]).toBe("^2.1.0");

      // 4. file: dependencies are strictly excluded
      expect(exportedPkg.dependencies["file-dep"]).toBeUndefined();

      // 5. Normal dependencies are preserved
      expect(exportedPkg.dependencies["external-dep"]).toBe("^1.0.0");

      // 6. devDependencies are omitted entirely
      expect(exportedPkg.devDependencies).toBeUndefined();
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

      // 验证不再生成 actiondock.skill.json
      expect(existsSync(join(exportRes.skillDir, "actiondock.skill.json"))).toBe(false);

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
          `---\nid: deploy\nname: 部署规程\ndescription: 自动化部署标准流程\n---\n# 部署规程`,
          "utf-8"
        );

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

    it("resolves external linked action in BuildPlanner when linked package has no actiondock.manifest.json", () => {
      const extDir = mkdtempSync(join(tmpdir(), "ext-pkg-"));
      try {
        initProject(extDir, { id: "test.ext-tools", name: "External Tools" });
        writeFileSync(
          join(extDir, "actions", "calc.ts"),
          `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "calc", uses: [], run: () => 42 });`
        );
        // extDir does NOT have actiondock.manifest.json!
        linkPackage(extDir);

        const planner = new BuildPlanner({ projectRoot: tempDir });
        const plan = planner.plan({
          projectRoot: tempDir,
          manifest: {
            schemaVersion: 1,
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
            id: "custom-dirs-pkg",
            name: "Custom Dirs",
            version: "1.0.0",
            actionsDir: "src/my-actions",
            playbooksDir: "docs/my-playbooks",
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
          `---\nid: guide\n---\n# Guide`
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
  });
});
