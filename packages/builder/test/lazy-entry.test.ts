import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { buildProject } from "../src/build";
import { loadManifest } from "@actiondock/core/project";
import type { SelectionPlan } from "../src/types";

/**
 * 独立交付入口惰性化验证：
 * - 生成的 entry-host.js 不再包含静态 import action_N 语句；
 * - 产物 list / describe 不触发业务模块顶层副作用（由 CLI standalone 测试覆盖进程级验证）；
 * - 复用 serializePlanManifest 的清单序列化单一事实源。
 */

describe("独立产物入口惰性化", () => {
  let tempDir: string;
  let projectRoot: string;
  let outDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-lazy-entry-"));
    projectRoot = join(tempDir, "project");
    outDir = join(tempDir, "out");
    mkdirSync(join(projectRoot, "actions"), { recursive: true });

    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "pkg.lazy-entry",
          name: "Lazy Entry",
          version: "1.0.0",
          actions: {
            greet: {
              entry: "actions/greet.js",
              description: "greet action",
              inputSchema: { type: "object", properties: { name: { type: "string" } } },
              outputSchema: { type: "object", properties: { message: { type: "string" } } },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    writeFileSync(
      join(projectRoot, "actions", "greet.js"),
      [
        "// 业务模块顶层副作用标记：惰性入口下发现阶段不得执行本文件",
        "globalThis.__LAZY_ENTRY_SIDE_EFFECT__ = (globalThis.__LAZY_ENTRY_SIDE_EFFECT__ || 0) + 1;",
        "export default { run: async (input) => ({ message: `hello ${input.name}` }) };",
      ].join("\n"),
      "utf-8"
    );
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  it("生成的 Host 入口不包含静态 Action 导入语句", async () => {
    await buildProject({ projectRoot, outDir });

    const hostEntryPath = join(outDir, "entry-host.js");
    assert.strictEqual(existsSync(hostEntryPath), true);
    const hostSource = readFileSync(hostEntryPath, "utf-8");

    // 不再生成 import action_N 静态导入
    assert.strictEqual(/import\s+action_\d+\s+from/.test(hostSource), false);
    // 不再生成动态定义字典形式的内存注入（actions: [ ... ] 数组注册）
    assert.strictEqual(/actions:\s*\[\s*\{/.test(hostSource), false);
    // 携带清单元数据（manifest actions 字典）与产物根目录基准
    assert.ok(hostSource.includes("actions:"));
    assert.ok(hostSource.includes("import.meta.dirname"));
  });

  it("入口清单元数据与 serializePlanManifest 单一事实源一致", async () => {
    await buildProject({ projectRoot, outDir });

    const hostSource = readFileSync(join(outDir, "entry-host.js"), "utf-8");
    const manifest = loadManifest(outDir);
    assert.notStrictEqual(manifest, null);
    const manifestActions = manifest!.actions as Record<string, any>;
    assert.ok(manifestActions.greet);
    assert.strictEqual(manifestActions.greet.entry, "actions/greet.js");

    // 入口内嵌的清单与落盘 actiondock.json 保持同一事实源字段
    assert.ok(hostSource.includes(JSON.stringify(manifestActions.greet.entry)));
    assert.ok(hostSource.includes("greet"));
  });

  it("构建产物保留执行链路：监督入口与 Host 入口并存且可被转发入口引用", async () => {
    await buildProject({ projectRoot, outDir });

    assert.strictEqual(existsSync(join(outDir, "entry-supervisor.js")), true);
    assert.strictEqual(existsSync(join(outDir, "entry.mjs")), true);
    const forwarder = readFileSync(join(outDir, "entry.mjs"), "utf-8");
    assert.ok(forwarder.includes("entry-supervisor.js"));
  });
});
