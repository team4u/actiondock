import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { symlinkSync } from "node:fs";
import { describe, it, beforeEach, afterEach } from "node:test";
import { buildProject } from "@actiondock/builder";

/**
 * 独立产物进程级惰性验证：
 * - 产物 list / describe 命令不触发业务模块顶层副作用（标记文件不产生）；
 * - run 执行后才加载业务模块（标记文件产生）；
 * - 在另一工作目录运行产物，行为一致（不依赖调用者当前工作目录）。
 */

function runCmd(
  cwd: string,
  args: string[],
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    proc.on("error", reject);
  });
}

describe("独立产物发现零业务副作用（进程级）", () => {
  let tempDir: string;
  let projectRoot: string;
  let outDir: string;
  let otherCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-lazy-e2e-"));
    projectRoot = join(tempDir, "project");
    outDir = join(tempDir, "out");
    otherCwd = join(tempDir, "other-cwd");
    mkdirSync(join(projectRoot, "actions"), { recursive: true });
    mkdirSync(otherCwd, { recursive: true });

    // 软链根 node_modules 保证产物运行期依赖解析（与 builder 测试同策略）
    const rootNodeModules = join(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(outDir, "..", "node_modules"), "junction");
      } catch {}
    }

    const sideEffectFile = join(tempDir, "side-effect.marker");

    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "pkg.lazy-e2e",
          name: "Lazy E2E",
          version: "1.0.0",
          actions: {
            probe: {
              entry: "actions/probe.js",
              description: "probe action",
              inputSchema: { type: "object", properties: {} },
              outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    writeFileSync(
      join(projectRoot, "actions", "probe.js"),
      [
        "import { appendFileSync } from \"node:fs\";",
        // 顶层副作用：模块被加载即写标记文件
        `appendFileSync(${JSON.stringify(sideEffectFile)}, "loaded\\n");`,
        "export default { run: async () => ({ ok: true }) };",
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

  it("产物 list / describe 不导入业务模块，run 后才加载", { timeout: 120_000 }, async () => {
    await buildProject({ projectRoot, outDir });

    const marker = join(tempDir, "side-effect.marker");
    const entry = join(outDir, "entry.mjs");

    // 发现：list
    const listRes = await runCmd(otherCwd, [entry, "list", "--json"], {
      ACTIONDOCK_HOME: join(tempDir, "home"),
    });
    assert.strictEqual(listRes.code, 0, `list failed: ${listRes.stderr}`);
    const listPayload = JSON.parse(listRes.stdout);
    assert.ok(listPayload.items.some((i: any) => i.id.includes("probe")));
    assert.strictEqual(existsSync(marker), false, "list must not import action module");

    // 发现：describe
    const descRes = await runCmd(otherCwd, [entry, "describe", "probe", "--json"], {
      ACTIONDOCK_HOME: join(tempDir, "home"),
    });
    assert.strictEqual(descRes.code, 0, `describe failed: ${descRes.stderr}`);
    const descPayload = JSON.parse(descRes.stdout);
    assert.ok(descPayload.inputSchema, "describe must still expose full contract");
    assert.strictEqual(existsSync(marker), false, "describe must not import action module");

    // 执行：run（首次导入业务模块）
    const runRes = await runCmd(otherCwd, [entry, "run", "probe", "--input", "{}", "--json"], {
      ACTIONDOCK_HOME: join(tempDir, "home"),
    });
    assert.strictEqual(runRes.code, 0, `run failed: ${runRes.stderr}`);
    const runPayload = JSON.parse(runRes.stdout);
    assert.strictEqual(runPayload.ok, true);
    assert.strictEqual(existsSync(marker), true, "run must load action module");
  });
});
