import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { saveManifest } from "@actiondock/core/project";
import {
  SelectionPlanner,
  exportSkill,
  BuilderError,
} from "../src";
import {
  assertRelativeDependenciesIntegrity,
  extractRelativeSpecifiers,
  resolveRelativeModule,
} from "../src/dependency-check";

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
      assert.ok((specifiers).includes("../src/utils.js"));
      assert.ok((specifiers).includes("./side-effect.js"));
      assert.ok((specifiers).includes("./types"));
      assert.ok((specifiers).includes("./helpers/sub.js"));
      assert.ok((specifiers).includes("./all.js"));
      assert.ok((specifiers).includes("./dynamic.js"));
      assert.ok((specifiers).includes("./legacy.cjs"));

      assert.ok(!(specifiers).includes("@actiondock/sdk"));
      assert.ok(!(specifiers).includes("node:fs"));
      assert.ok(!(specifiers).includes("./ignored1.js"));
      assert.ok(!(specifiers).includes("../ignored2.js"));
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
      assert.notStrictEqual(resolvedTs, undefined);
      assert.strictEqual(resolvedTs?.endsWith("utils.ts"), true);

      // 2. 目录 index 解析
      const resolvedIndex = resolveRelativeModule(actionsDir, "../sub");
      assert.notStrictEqual(resolvedIndex, undefined);
      assert.strictEqual(resolvedIndex?.endsWith("index.ts"), true);

      // 3. 不存在的文件
      const notFound = resolveRelativeModule(actionsDir, "./missing.js");
      assert.strictEqual(notFound, undefined);
    });
  });

  describe("assertRelativeDependenciesIntegrity 依赖边界硬性断言与报错", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ad-integrity-test-"));

      const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
      if (existsSync(rootNodeModules)) {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
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
      assert.throws(() => {
        SelectionPlanner.plan({ projectRoot: tempDir });
      }, BuilderError);
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
      assert.notStrictEqual(plan, undefined);
      assert.strictEqual(plan.dependencies.modulesAndAssets.some((m) => m.path.includes("utils.ts")), true);

      // 5. 导出 Skill 也应顺利通过并将 src/utils.ts 包含在产物中
      const outDir = join(tempDir, "dist", "skill");
      const exportRes = await exportSkill({
        projectRoot: tempDir,
        outDir,
        mode: "source",
      });
      assert.strictEqual(exportRes.mode, "source");
      assert.strictEqual(existsSync(join(outDir, "src", "utils.ts")), true);
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

      assert.throws(() => {
        SelectionPlanner.plan({ projectRoot: tempDir });
      }, /does not exist on disk/);
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
      assert.notStrictEqual(plan, undefined);
    });

    it("当 Action 引用越出项目根目录的相对路径模块时抛出 EXTERNAL_LOCAL_DEPENDENCY", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "ad-outside-pkg-"));
      try {
        const outsideModule = join(outsideDir, "outside.ts");
        writeFileSync(outsideModule, "export const outsideVal = 42;\n");

        const actionFile = join(tempDir, "actions", "greet.ts");
        const relToOutside = relative(join(tempDir, "actions"), outsideModule).replace(/\\/g, "/");
        writeFileSync(
          actionFile,
          `import { defineAction } from "@actiondock/sdk";
import { outsideVal } from "${relToOutside}";

export default defineAction(async () => {
  return { outsideVal };
});
`
        );

        assert.throws(() => {
          SelectionPlanner.plan({ projectRoot: tempDir });
        }, BuilderError);
      } finally {
        if (existsSync(outsideDir)) {
          rmSync(outsideDir, { recursive: true, force: true });
        }
      }
    });

    it("当 Action 引用完全位于项目外部的深层路径时给出项目外路径提示分支", () => {
      // 项目嵌套一层：projectRoot 的父目录为嵌套基座，外部模块位于另一个 tmp 子树下（父目录之外）
      const nestedBase = mkdtempSync(join(tmpdir(), "ad-outside-deep-base-"));
      const projectDir = join(nestedBase, "inner-project");
      const otherTree = mkdtempSync(join(tmpdir(), "ad-outside-deep-other-"));
      try {
        initProject(projectDir, { id: "test.deep-outside", name: "Deep Outside" });
        const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
        if (existsSync(rootNodeModules)) {
          symlinkSync(rootNodeModules, join(projectDir, "node_modules"), "junction");
        }

        const outsideModule = join(otherTree, "helper.ts");
        writeFileSync(outsideModule, "export const deepVal = 7;\n");

        const actionFile = join(projectDir, "actions", "greet.ts");
        const relToOutside = relative(join(projectDir, "actions"), outsideModule).replace(/\\/g, "/");
        writeFileSync(
          actionFile,
          `import { defineAction } from "@actiondock/sdk";
import { deepVal } from "${relToOutside}";

export default defineAction(async () => {
  return { deepVal };
});
`
        );

        assert.throws(() => {
          SelectionPlanner.plan({ projectRoot: projectDir });
        }, BuilderError);
      } finally {
        if (existsSync(nestedBase)) {
          rmSync(nestedBase, { recursive: true, force: true });
        }
        if (existsSync(otherTree)) {
          rmSync(otherTree, { recursive: true, force: true });
        }
      }
    });

    it("当 Action 引用位于 ..cache 目录中的本地模块且声明在 files 时顺利通过校验", () => {
      const cacheDir = join(tempDir, "..cache");
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, "helper.ts"), "export const helperVal = 99;\n");

      const actionFile = join(tempDir, "actions", "greet.ts");
      writeFileSync(
        actionFile,
        `import { defineAction } from "@actiondock/sdk";
import { helperVal } from "../..cache/helper.js";

export default defineAction(async () => {
  return { helperVal };
});
`
      );

      saveManifest(tempDir, {
        id: "test.integrity",
        actions: {
          "sample.greet": {
            entry: "actions/greet.ts",
            description: "Greet action",
          },
        },
        files: ["..cache"],
      });

      const plan = SelectionPlanner.plan({ projectRoot: tempDir });
      assert.notStrictEqual(plan, undefined);
      assert.strictEqual(plan.dependencies.modulesAndAssets.some((m) => m.path.includes("helper.ts")), true);
    });
  });
});
