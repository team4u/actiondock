import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSemVer } from "../src/utils/semver.ts";
import { bumpSemver, extractPrereleaseTag, normalizeSemver, parseSemver } from "../../../scripts/lib/semver.ts";
import { discoverWorkspacePackages } from "../../../scripts/lib/discover-workspace-packages.ts";
import { alignInternalDependencies, internalDependencyRange } from "../../../scripts/lib/align-dependencies.ts";
import { createCommandRunner } from "../../../scripts/lib/run-command.ts";

const rootDir = resolve(import.meta.dirname, "../../..");

describe("工程脚本域共享辅助测试套件", () => {
  describe("语义化版本解析与递增", () => {
    it("严格三段式解析并容忍 v/= 前缀与预发布后缀", () => {
      assert.deepStrictEqual(parseSemVer("2.10.0"), { major: 2, minor: 10, patch: 0, prerelease: undefined });
      const pre = parseSemVer("v2.10.1-beta.3");
      assert.strictEqual(pre?.major, 2);
      assert.strictEqual(pre?.patch, 1);
      assert.strictEqual(pre?.prerelease, "beta.3");
      assert.strictEqual(parseSemVer("=2.0.0")?.minor, 0);
      assert.strictEqual(parseSemVer("2.10"), null);
      assert.strictEqual(parseSemVer("2.10.0.1"), null);
      assert.strictEqual(parseSemVer("abc"), null);
    });

    it("parseSemver 非法输入抛错且 normalizeSemver 返回规范串或 null", () => {
      assert.throws(() => parseSemver("not-a-version"), /非法的语义化版本号/);
      assert.strictEqual(normalizeSemver(" v2.10.1-beta.0 "), "2.10.1-beta.0");
      assert.strictEqual(normalizeSemver("2.10"), null);
    });

    it("bumpSemver 各递增类型与预发布语义符合脚本既有行为", () => {
      assert.strictEqual(bumpSemver("2.10.0", "patch"), "2.10.1");
      assert.strictEqual(bumpSemver("2.10.0", "minor"), "2.11.0");
      assert.strictEqual(bumpSemver("2.10.0", "major"), "3.0.0");
      // 已带预发布后缀时 patch 类型收敛为去除后缀的稳定版
      assert.strictEqual(bumpSemver("2.10.1-beta.0", "patch"), "2.10.1");
      // 预发布递增：带序号则递增序号，否则从 patch 进位并附加 preId.0
      assert.strictEqual(bumpSemver("2.10.1-beta.2", "prerelease", "beta"), "2.10.1-beta.3");
      assert.strictEqual(bumpSemver("2.10.1-beta", "prerelease", "beta"), "2.10.1-beta.0");
      assert.strictEqual(bumpSemver("2.10.0", "prerelease", "rc"), "2.10.1-rc.0");
    });

    it("extractPrereleaseTag 提取预发布分发标签，非预发布返回 null", () => {
      assert.strictEqual(extractPrereleaseTag("2.8.1-beta.0"), "beta");
      assert.strictEqual(extractPrereleaseTag("2.8.1-Alpha.2"), "alpha");
      assert.strictEqual(extractPrereleaseTag("2.8.1"), null);
      assert.strictEqual(extractPrereleaseTag("bad"), null);
    });

  });

  describe("工作区发现与内部依赖提取", () => {
    it("发现全部 @actiondock 子包并携带内部依赖信息", () => {
      const pkgs = discoverWorkspacePackages(rootDir);
      assert.ok(pkgs.length >= 6);
      const byName = new Map(pkgs.map((p) => [p.name, p]));
      const core = byName.get("@actiondock/core");
      assert.ok(core, "core 子包应被发现");
      assert.strictEqual(core?.shortName, "core");
      assert.ok(core?.dir.endsWith(join("packages", "core")));
      assert.deepStrictEqual(core?.dependencies, ["@actiondock/sdk"]);
      const cli = byName.get("@actiondock/cli");
      assert.deepStrictEqual(cli?.dependencies, [
        "@actiondock/builder",
        "@actiondock/core",
        "@actiondock/mcp",
        "@actiondock/sdk",
      ]);
    });

    it("兼容 workspaces 对象形态并按短名排序", () => {
      const tmpRoot = mkdtempSync(join(tmpdir(), "ad-ws-disc-"));
      try {
        writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ workspaces: { packages: ["packages/*"] } }));
        const sub = join(tmpRoot, "packages", "zzz");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(sub, "package.json"), JSON.stringify({ name: "@actiondock/zzz", dependencies: { "@actiondock/sdk": "^1.0.0" } }));
        const found = discoverWorkspacePackages(tmpRoot);
        assert.strictEqual(found.length, 1);
        assert.strictEqual(found[0]?.name, "@actiondock/zzz");
        assert.deepStrictEqual(found[0]?.dependencies, ["@actiondock/sdk"]);
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });

  describe("内部依赖对齐（稳定与预发布）", () => {
    it("正式版本使用 ^ 范围且仅触碰 @actiondock 前缀依赖", () => {
      const pkg: Record<string, unknown> = {
        dependencies: { "@actiondock/sdk": "^2.9.0", lodash: "^4.0.0" },
        peerDependencies: { "@actiondock/core": "2.9.0" },
        devDependencies: { "@actiondock/testing": "^2.9.0" },
      };
      alignInternalDependencies(pkg, "2.10.0");
      assert.deepStrictEqual(pkg.dependencies, { "@actiondock/sdk": "^2.10.0", lodash: "^4.0.0" });
      assert.deepStrictEqual(pkg.peerDependencies, { "@actiondock/core": "^2.10.0" });
      assert.deepStrictEqual(pkg.devDependencies, { "@actiondock/testing": "^2.10.0" });
    });

    it("预发布版本严格对齐目标版本号避免回退加载旧稳定版", () => {
      assert.strictEqual(internalDependencyRange("2.10.1-beta.0"), "2.10.1-beta.0");
      assert.strictEqual(internalDependencyRange("2.10.0"), "^2.10.0");
      const pkg: Record<string, unknown> = {
        dependencies: { "@actiondock/sdk": "^2.10.0" },
        peerDependencies: { "@actiondock/core": "^2.10.0" },
        devDependencies: { "@actiondock/testing": "^2.10.0" },
      };
      alignInternalDependencies(pkg, "2.10.1-beta.3");
      assert.deepStrictEqual(pkg.dependencies, { "@actiondock/sdk": "2.10.1-beta.3" });
      assert.deepStrictEqual(pkg.peerDependencies, { "@actiondock/core": "2.10.1-beta.3" });
      assert.deepStrictEqual(pkg.devDependencies, { "@actiondock/testing": "2.10.1-beta.3" });
    });

    it("未声明的依赖段跳过不创建空段", () => {
      const pkg: Record<string, unknown> = { dependencies: { "@actiondock/sdk": "^2.10.0" } };
      alignInternalDependencies(pkg, "2.11.0");
      assert.strictEqual("peerDependencies" in pkg, false);
    });
  });

  describe("工程命令执行", () => {
    it("绑定默认目录并允许调用方覆盖，失败时抛错或返回结果", () => {
      const dir = mkdtempSync(join(tmpdir(), "ad-command-"));
      const override = join(dir, "override");
      try {
        mkdirSync(override);
        const probe = "console.log(process.cwd()); process.exit(process.argv.includes('--fail') ? 7 : 0);";
        for (const cwd of [dir, override]) {
          writeFileSync(join(cwd, "probe.mjs"), probe);
        }
        const run = createCommandRunner(dir);
        assert.strictEqual(run(process.execPath, ["probe.mjs"], { captureOutput: true }).stdout.trim(), dir);
        assert.strictEqual(run(process.execPath, ["probe.mjs"], { cwd: override, captureOutput: true }).stdout.trim(), override);
        assert.throws(() => run(process.execPath, ["probe.mjs", "--fail"], { captureOutput: true }), /执行失败/);
        assert.strictEqual(run(process.execPath, ["probe.mjs", "--fail"], { captureOutput: true, allowFailure: true }).status, 7);
        assert.throws(() => run("actiondock-nonexistent-command", [], { captureOutput: true }), /actiondock-nonexistent-command/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("原生 Node 直接导入", () => {
    it("不依赖加载钩子即可导入全部工程辅助模块", () => {
      const helpers = ["semver", "discover-workspace-packages", "align-dependencies", "run-command"];
      const imports = helpers.map((name) => `await import(${JSON.stringify(pathToFileURL(join(rootDir, "scripts/lib", `${name}.ts`)).href)});`).join("\n");
      const pureUrl = pathToFileURL(join(rootDir, "packages/core/src/utils/semver.ts")).href;
      const probe = `${imports}\nconst m = await import(${JSON.stringify(pureUrl)}); console.log(JSON.stringify(m.parseSemVer("3.2.1")));`;
      const res = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
        encoding: "utf8",
        timeout: 30000,
      });
      assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
      assert.strictEqual(res.stdout.trim(), JSON.stringify({ major: 3, minor: 2, patch: 1 }));
    });
  });
});
