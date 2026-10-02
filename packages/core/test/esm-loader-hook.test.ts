import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeModuleLoader, registerModuleLoaderHook, getLoaderHookUrl } from "../src/platform/module-loader";
import { resolve as esmResolve } from "../src/platform/loader-hook";

describe("全链路 ESM 路径重映射加载器单元测试", () => {
  const testDir = mkdtempSync(join(tmpdir(), "test-esm-loader-"));

  before(() => {
    // 构造深层多级模块依赖拓扑：
    // entry.ts
    //   -> ./sibling.js (物理文件为 sibling.ts)
    //        -> ./nested/helper.js (物理文件为 nested/helper.ts)
    //             -> ./leaf.mjs (物理文件为 nested/leaf.mts)
    //                  -> ../common (物理文件为 common/index.ts)
    mkdirSync(join(testDir, "nested"), { recursive: true });
    mkdirSync(join(testDir, "common"), { recursive: true });

    // 底层公共模块
    writeFileSync(
      join(testDir, "common", "index.ts"),
      `
      export const commonValue: number = 10;
      `
    );

    // 叶子模块（.mts 源码，引用方以 .mjs 导入）
    writeFileSync(
      join(testDir, "nested", "leaf.mts"),
      `
      import { commonValue } from "../common";
      export const leafValue: number = commonValue + 20;
      `
    );

    // 嵌套辅助模块（.ts 源码，以 .mjs 导入兄弟 .mts 模块）
    writeFileSync(
      join(testDir, "nested", "helper.ts"),
      `
      import { leafValue } from "./leaf.mjs";
      export const helperValue: number = leafValue + 30;
      `
    );

    // 兄弟模块（.ts 源码，以 .js 导入子级 helper）
    writeFileSync(
      join(testDir, "sibling.ts"),
      `
      import { helperValue } from "./nested/helper.js";
      export const siblingValue: number = helperValue + 40;
      `
    );

    // 入口模块（.ts 源码，NodeNext 规范显式书写 ./sibling.js 目标后缀）
    writeFileSync(
      join(testDir, "entry.ts"),
      `
      import { siblingValue } from "./sibling.js";
      export const totalResult: number = siblingValue + 50;
      export default function calculate(): number {
        return totalResult;
      }
      `
    );

    // 现存实体 .js 文件模块（验证真实文件不被误重映射）
    writeFileSync(
      join(testDir, "existing.js"),
      `
      export const sourceFormat = "pure-javascript";
      `
    );
    writeFileSync(
      join(testDir, "import-existing.ts"),
      `
      import { sourceFormat } from "./existing.js";
      export const format = sourceFormat;
      `
    );
  });

  after(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("getLoaderHookUrl 正确解析现有钩子文件路径", () => {
    const url = getLoaderHookUrl();
    assert.strictEqual(typeof url, "string");
    assert.strictEqual(url.startsWith("file:"), true);
    assert.strictEqual(
      url.endsWith("loader-hook.ts") ||
        url.endsWith("loader-hook.js") ||
        url.endsWith("loader-hook.mjs"),
      true
    );
  });

  it("registerModuleLoaderHook 具备全局 Symbol 幂等防护与安全自注册机制", () => {
    assert.doesNotThrow(() => {
      registerModuleLoaderHook();
      registerModuleLoaderHook();
    });
  });

  it("NodeModuleLoader 初始化时自动激活钩子并成功穿透加载深层依赖拓扑", async () => {
    const loader = new NodeModuleLoader();
    const entryPath = join(testDir, "entry.ts");

    // 动态加载 entry.ts，由 Node 原生解析层自动拦截并重映射所有层级的 .js、.mjs 与目录导入
    const mod = await loader.load(entryPath);
    assert.strictEqual(mod.totalResult, 150);

    const calculate = await loader.loadDefault<() => number>(entryPath);
    assert.strictEqual(typeof calculate, "function");
    assert.strictEqual(calculate(), 150);
  });

  it("真实存在的物理 .js 文件不触发重映射并保持正常导入", async () => {
    const loader = new NodeModuleLoader();
    const testFile = join(testDir, "import-existing.ts");

    const mod = await loader.load(testFile);
    assert.strictEqual(mod.format, "pure-javascript");
  });

  it("标准解析钩子 resolve 纯函数单元行为校验", async () => {
    const dummyParentURL = pathToFileURL(join(testDir, "dummy.ts")).href;

    // 1. 相对路径且以 .js 结尾但物理文件不存在 -> 重定向至同名 .ts
    let redirectedSpecifier = "";
    await esmResolve(
      "./sibling.js",
      { conditions: ["node", "import"], parentURL: dummyParentURL },
      async (specifier: string) => {
        redirectedSpecifier = specifier;
        return { url: specifier };
      }
    );
    assert.strictEqual(redirectedSpecifier.endsWith("sibling.ts"), true);

    // 2. 相对路径且以 .mjs 结尾但物理文件不存在 -> 重定向至同名 .mts
    const nestedParentURL = pathToFileURL(join(testDir, "nested", "dummy.ts")).href;
    await esmResolve(
      "./leaf.mjs",
      { conditions: ["node", "import"], parentURL: nestedParentURL },
      async (specifier: string) => {
        redirectedSpecifier = specifier;
        return { url: specifier };
      }
    );
    assert.strictEqual(redirectedSpecifier.endsWith("leaf.mts"), true);

    // 3. 相对路径无扩展名目录导入 -> 重定向至 index.ts
    await esmResolve(
      "./common",
      { conditions: ["node", "import"], parentURL: dummyParentURL },
      async (specifier: string) => {
        redirectedSpecifier = specifier;
        return { url: specifier };
      }
    );
    assert.strictEqual(redirectedSpecifier.replace(/\\/g, "/").endsWith("common/index.ts"), true);

    // 4. 物理文件存在时直接透传原生路径
    let untouchedSpecifier = "";
    await esmResolve(
      "./existing.js",
      { conditions: ["node", "import"], parentURL: dummyParentURL },
      async (specifier: string) => {
        untouchedSpecifier = specifier;
        return { url: specifier };
      }
    );
    assert.strictEqual(untouchedSpecifier, "./existing.js");

    // 5. 非相对路径（如包名或 Node 内建模块）直接透传
    let bareSpecifier = "";
    await esmResolve(
      "node:path",
      { conditions: ["node", "import"], parentURL: dummyParentURL },
      async (specifier: string) => {
        bareSpecifier = specifier;
        return { url: specifier };
      }
    );
    assert.strictEqual(bareSpecifier, "node:path");
  });

  it("通过 loadActions 加载书写 .js 相对导入的 Action 源码并成功执行", async () => {
    const { loadActions } = await import("../src/project/loader.ts");
    const projectDir = join(testDir, "sample-project");
    mkdirSync(join(projectDir, "actions"), { recursive: true });

    writeFileSync(
      join(projectDir, "actiondock.json"),
      JSON.stringify({
        id: "sample-project",
        name: "Sample Project",
        version: "1.0.0",
        actions: {
          greet: {
            entry: "actions/greet.ts",
          },
        },
      })
    );

    writeFileSync(
      join(projectDir, "actions", "formatter.ts"),
      `
      export function formatGreeting(name: string): string {
        return "Hello, " + name + "!";
      }
      `
    );

    writeFileSync(
      join(projectDir, "actions", "greet.ts"),
      `
      import { formatGreeting } from "./formatter.js";
      export default {
        run: async (input: { name: string }) => {
          return { message: formatGreeting(input.name) };
        },
      };
      `
    );

    const actions = await loadActions(projectDir);
    const greetAction = actions.get("greet");
    assert.notStrictEqual(greetAction, undefined);

    const result = await greetAction?.run({ name: "ActionDock" }, {} as any);
    assert.deepStrictEqual(result, { message: "Hello, ActionDock!" });
  });
});

