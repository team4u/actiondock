import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject, saveManifest } from "@actiondock/core";
import {
  assertRelativeDependenciesIntegrity,
  extractRelativeSpecifiers,
  resolveRelativeModule,
  SelectionPlanner,
  exportSkill,
  BuilderError,
} from "../src";

describe("本地相对路径依赖完整性校验", () => {
  describe("extractRelativeSpecifiers 提取相对导入说明符", () => {
    it("正确提取各种相对导入与导出语句并过滤包导入与注释", () => {
      const code = `
        // import { ignored1 } from "./ignored1.js";
        /*
          import { ignored2 } from "../ignored2.js";
        */
        import { defineAction } from "@actiondock/sdk";
        import fs from "node:fs";
        import { util } from "../src/utils.js";
        import "./side-effect.js";
        import type { MyType } from "./types";
        export { helper } from "./helpers/sub.js";
        export * from "./all.js";

        async function test() {
          const mod = await import("./dynamic.js");
          const legacy = require("./legacy.cjs");
        }
      `;

      const specifiers = extractRelativeSpecifiers(code);
      expect(specifiers).toContain("../src/utils.js");
      expect(specifiers).toContain("./side-effect.js");
      expect(specifiers).toContain("./types");
      expect(specifiers).toContain("./helpers/sub.js");
      expect(specifiers).toContain("./all.js");
      expect(specifiers).toContain("./dynamic.js");
      expect(specifiers).toContain("./legacy.cjs");

      expect(specifiers).not.toContain("@actiondock/sdk");
      expect(specifiers).not.toContain("node:fs");
      expect(specifiers).not.toContain("./ignored1.js");
      expect(specifiers).not.toContain("../ignored2.js");
    });
  });

  describe("resolveRelativeModule 路径映射解析", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ad-resolve-test-"));
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("正确支持 .js 到 .ts 的 ESM 映射以及无扩展名与 index 解析", () => {
      const srcDir = join(tempDir, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "utils.ts"), "export const ok = 1;");

      const subDir = join(tempDir, "sub");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "index.ts"), "export const indexOk = 1;");

      const actionsDir = join(tempDir, "actions");
      mkdirSync(actionsDir, { recursive: true });

      // 1. .js 映射为 .ts
      const resolvedTs = resolveRelativeModule(actionsDir, "../src/utils.js");
      expect(resolvedTs).toBeDefined();
      expect(resolvedTs?.endsWith("utils.ts")).toBe(true);

      // 2. 目录 index 解析
      const resolvedIndex = resolveRelativeModule(actionsDir, "../sub");
      expect(resolvedIndex).toBeDefined();
      expect(resolvedIndex?.endsWith("index.ts")).toBe(true);

      // 3. 不存在的文件
      const notFound = resolveRelativeModule(actionsDir, "./missing.js");
      expect(notFound).toBeUndefined();
    });
  });

  describe("assertRelativeDependenciesIntegrity 依赖边界硬性断言与报错", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ad-integrity-test-"));

      const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
      if (existsSync(rootNodeModules)) {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
      }

      initProject(tempDir, {
        id: "test.integrity",
        name: "Integrity Test Package",
      });
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("当 Action 引用未在 files 中声明的本地 src 模块时直接报错阻断", () => {
      // 1. 创建 src/utils.ts
      const srcDir = join(tempDir, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "utils.ts"), "export const magic = 42;\n");

      // 2. 修改 actions/greet.ts 引入 ../src/utils.js
      const actionFile = join(tempDir, "actions", "greet.ts");
      writeFileSync(
        actionFile,
        `import { defineAction } from "@actiondock/sdk";
import { magic } from "../src/utils.js";

export default defineAction(async () => {
  return { magic };
});
`
      );

      // 3. 规划构建：因未声明 files，必须直接报错抛出 UNMET_LOCAL_DEPENDENCY
      let errorThrown: any = null;
      try {
        SelectionPlanner.plan({ projectRoot: tempDir });
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect(errorThrown instanceof BuilderError).toBe(true);
      expect(errorThrown.code).toBe("UNMET_LOCAL_DEPENDENCY");
      expect(errorThrown.message).toContain("src/utils.ts");
      expect(errorThrown.message).toContain("files");
    });

    it("在 actiondock.json 中声明 files 后校验顺利通过", async () => {
      // 1. 创建 src/utils.ts
      const srcDir = join(tempDir, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "utils.ts"), "export const magic = 42;\n");

      // 2. 修改 actions/greet.ts 引入 ../src/utils.js
      const actionFile = join(tempDir, "actions", "greet.ts");
      writeFileSync(
        actionFile,
        `import { defineAction } from "@actiondock/sdk";
import { magic } from "../src/utils.js";

export default defineAction(async () => {
  return { magic };
});
`
      );

      // 3. 在清单中显式声明 files
      saveManifest(tempDir, {
        id: "test.integrity",
        actions: {
          "sample.greet": {
            entry: "actions/greet.ts",
            description: "Greet action",
          },
        },
        files: ["src"],
      });

      // 4. 重新规划构建，校验通过
      const plan = SelectionPlanner.plan({ projectRoot: tempDir });
      expect(plan).toBeDefined();
      expect(plan.dependencies.modulesAndAssets.some((m) => m.path.includes("utils.ts"))).toBe(true);

      // 5. 导出 Skill 也应顺利通过并将 src/utils.ts 包含在产物中
      const outDir = join(tempDir, "dist", "skill");
      const exportRes = await exportSkill({
        projectRoot: tempDir,
        outDir,
        mode: "source",
      });
      expect(exportRes.mode).toBe("source");
      expect(existsSync(join(outDir, "src", "utils.ts"))).toBe(true);
    });

    it("当 Action 引用不存在的相对路径文件时报错 FILE_NOT_FOUND", () => {
      const actionFile = join(tempDir, "actions", "greet.ts");
      writeFileSync(
        actionFile,
        `import { defineAction } from "@actiondock/sdk";
import { missing } from "./not-exist.js";

export default defineAction(async () => {
  return { missing };
});
`
      );

      expect(() => {
        SelectionPlanner.plan({ projectRoot: tempDir });
      }).toThrow(/does not exist on disk/);
    });

    it("通过 skipDependencyValidation 选项可按需跳过校验", () => {
      const actionFile = join(tempDir, "actions", "greet.ts");
      writeFileSync(
        actionFile,
        `import { defineAction } from "@actiondock/sdk";
import { missing } from "./not-exist.js";

export default defineAction(async () => {
  return { missing };
});
`
      );

      const plan = SelectionPlanner.plan({
        projectRoot: tempDir,
        skipDependencyValidation: true,
      });
      expect(plan).toBeDefined();
    });
  });
});
