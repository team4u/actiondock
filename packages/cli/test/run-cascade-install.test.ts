import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI ad run - 级联依赖准备与边界控制", () => {
  function setupFixture() {
    const rootDir = mkdtempSync(join(tmpdir(), "ad-cascade-test-"));
    const customHome = join(rootDir, "home");
    const markerFile = join(rootDir, "marker.txt");
    mkdirSync(customHome, { recursive: true });
    writeFileSync(markerFile, "");

    function createLibrary(name: string, prefix: string): string {
      const dir = join(rootDir, name);
      mkdirSync(dir);
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        exports: { ".": "./index.js" },
        scripts: { postinstall: 'node -e "process.exit(1)"' },
      }));
      writeFileSync(join(dir, "index.js"), `export const compute = value => ${JSON.stringify(prefix)} + value;\n`);
      return pathToFileURL(dir).href;
    }

    function createPackage(
      id: string,
      actions: Record<string, { code: string; uses?: string[] }>,
      dependencies: Record<string, string> = {}
    ): string {
      const dir = join(rootDir, id);
      mkdirSync(join(dir, "actions"), { recursive: true });
      const entries = Object.fromEntries(Object.entries(actions).map(([name, action]) => {
        const entry = `actions/${name}.js`;
        writeFileSync(join(dir, entry), action.code);
        return [name, { entry, uses: action.uses }];
      }));
      writeFileSync(join(dir, "actiondock.json"), JSON.stringify({ id, name: id, version: "1.0.0", actions: entries }));
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: id, version: "1.0.0", type: "module", dependencies }));
      return dir;
    }

    // 安装脚本故意失败；真实安装成功可以证明默认禁用了生命周期脚本。
    const libB = createLibrary("local-lib-b", "b:");
    const libC = createLibrary("local-lib-c", "c:");
    const markerImport = `import { appendFileSync } from "node:fs";\n`;
    const mark = (value: string) => `appendFileSync(${JSON.stringify(markerFile)}, ${JSON.stringify(value + "\n")});`;

    const dirC = createPackage("pkg-c", {
      "step-c": {
        code: `${markerImport}
import { compute } from "local-lib-c";
export default { run(input) {
  ${mark("c-executed")}
  return { result: compute(input.value) };
} };`,
      },
    }, { "local-lib-c": libC });

    const dirB = createPackage("pkg-b", {
      "step-b": {
        uses: ["pkg-c/step-c"],
        code: `${markerImport}
import { compute } from "local-lib-b";
export default { async run(input, ctx) {
  ${mark("b-executed")}
  const child = await ctx.actions.invoke("pkg-c/step-c", { value: input.value });
  return { result: compute(child.result) };
} };`,
      },
    }, { "local-lib-b": libB });

    const dirD = createPackage("pkg-d", {
      "step-d": { code: "export default { run() { return { ok: true }; } };\n" },
    }, { "uninstalled-missing-dep": "1.0.0" });

    const dirA = createPackage("pkg-a", {
      parallel: {
        uses: ["pkg-b/step-b", "pkg-d/step-d"],
        code: `${markerImport}
export default { async run(input, ctx) {
  ${mark("a-executed")}
  const [res1, res2] = await Promise.all([
    ctx.actions.invoke("pkg-b/step-b", { value: "v1" }),
    ctx.actions.invoke("pkg-b/step-b", { value: "v2" })
  ]);
  return { res1, res2 };
} };`,
      },
      failing: {
        uses: ["pkg-b/step-b"],
        code: `${markerImport}
export default { async run(input, ctx) {
  ${mark("a-started")}
  return ctx.actions.invoke("pkg-b/step-b", { value: "vf" });
} };`,
      },
    });

    const env: Record<string, string> = {
      ACTIONDOCK_HOME: customHome,
      ACTIONDOCK_AUTO_INSTALL: "true",
      ACTIONDOCK_INSTALLER: "npm",
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    };
    return { rootDir, markerFile, dirA, dirB, dirC, dirD, env };
  }

  it("已登记 A→B→C 的并发调用合并准备，未调用的授权包不安装，父动作不重跑", async () => {
    const f = setupFixture();
    try {
      for (const dir of [f.dirB, f.dirC, f.dirD]) {
        const linked = await runCliAsync(["link", dir], dir, f.env);
        assert.strictEqual(linked.exitCode, 0, linked.stderr.toString());
        assert.strictEqual(existsSync(join(dir, "node_modules")), false);
      }

      const result = await runCliAsync(["run", "parallel", "--json"], f.dirA, f.env);
      assert.strictEqual(result.exitCode, 0, `${result.stdout.toString()}\n${result.stderr.toString()}`);
      const parsed = JSON.parse(result.stdout.toString());
      assert.strictEqual(parsed.ok, true);
      assert.deepStrictEqual(parsed.data, {
        res1: { result: "b:c:v1" },
        res2: { result: "b:c:v2" },
      });
      assert.strictEqual(existsSync(join(f.dirB, "node_modules")), true);
      assert.strictEqual(existsSync(join(f.dirC, "node_modules")), true);
      assert.strictEqual(existsSync(join(f.dirD, "node_modules")), false);
      assert.strictEqual((result.stderr.toString().match(/\[actiondock\] Installing dependencies in /g) ?? []).length, 2);

      const markers = readFileSync(f.markerFile, "utf-8").trim().split("\n");
      assert.strictEqual(markers.filter((value) => value === "a-executed").length, 1);
      assert.strictEqual(markers.filter((value) => value === "b-executed").length, 2);
      assert.strictEqual(markers.filter((value) => value === "c-executed").length, 2);
    } finally {
      rmSync(f.rootDir, { recursive: true, force: true });
    }
  });

  it("--no-install 穿透子调用，保留父动作的一次副作用且不执行子动作", async () => {
    const f = setupFixture();
    try {
      for (const dir of [f.dirB, f.dirC]) {
        const linked = await runCliAsync(["link", dir], dir, f.env);
        assert.strictEqual(linked.exitCode, 0, linked.stderr.toString());
      }
      const result = await runCliAsync(["run", "failing", "--no-install", "--json"], f.dirA, f.env);
      assert.strictEqual(result.exitCode, 1);
      const parsed = JSON.parse(result.stdout.toString());
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "DEPENDENCIES_NOT_READY", JSON.stringify(parsed));
      assert.deepStrictEqual(readFileSync(f.markerFile, "utf-8").trim().split("\n"), ["a-started"]);
      assert.strictEqual(existsSync(join(f.dirB, "node_modules")), false);
      assert.strictEqual(existsSync(join(f.dirC, "node_modules")), false);
    } finally {
      rmSync(f.rootDir, { recursive: true, force: true });
    }
  });
});
