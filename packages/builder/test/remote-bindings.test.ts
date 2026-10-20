import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { SelectionPlanner } from "../src/planner";
import { exportSkill } from "../src/exporter";
import { PlannerError } from "../src/errors";
import { ActionDockError } from "@actiondock/core";

describe("远端动作绑定规划与依赖隔离", () => {
  let tempDir: string;
  let projectRoot: string;
  let outDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-remote-test-"));
    projectRoot = join(tempDir, "project");
    outDir = join(tempDir, "out");
    mkdirSync(join(projectRoot, "actions"), { recursive: true });
    mkdirSync(join(projectRoot, ".actiondock"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  it("仅远端实现的 uses 依赖正常通过规划且记录 remoteActionRefs", async () => {
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "pkg.caller",
          name: "Caller Package",
          version: "1.0.0",
          actions: {
            invoke: {
              entry: "actions/invoke.js",
              description: "invoke remote action",
              uses: ["cloud-pkg/remote-worker"],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, "actions", "invoke.js"),
      "export default { run: async () => ({ ok: true }) };",
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, ".actiondock", "bindings.json"),
      JSON.stringify(
        {
          bindings: {
            "cloud-pkg/remote-worker": {
              name: {
                type: "remote",
                profile: "prod-cloud",
              },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const plan = SelectionPlanner.plan({ projectRoot });

    // 仅保留本地源码 action，远端依赖不加入物理 actionDependencies
    assert.strictEqual(plan.actions.length, 1);
    assert.strictEqual(plan.actions[0].id, "invoke");
    // 调用方 action 的原始 uses 声明严格保留
    assert.deepStrictEqual(plan.actions[0].uses, ["cloud-pkg/remote-worker"]);
    // 规划产物记录可观测的 remoteActionRefs
    assert.deepStrictEqual(plan.remoteActionRefs, ["cloud-pkg/remote-worker"]);
  });

  it("未配置远端绑定的缺失依赖保持抛出错误且不被吞没", async () => {
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "pkg.missing",
          name: "Missing Dependency Package",
          version: "1.0.0",
          actions: {
            invoke: {
              entry: "actions/invoke.js",
              description: "invoke missing action",
              uses: ["unbound-pkg/missing-act"],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, "actions", "invoke.js"),
      "export default { run: async () => ({ ok: true }) };",
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, ".actiondock", "bindings.json"),
      JSON.stringify(
        {
          bindings: {
            "other-pkg/action": {
              primary: { type: "remote", profile: "dev" },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    assert.throws(
      () => SelectionPlanner.plan({ projectRoot }),
      (err: any) => {
        assert(err instanceof ActionDockError);
        assert(err.message.includes("unbound-pkg"));
        return true;
      }
    );
  });

  it("本地与远端同名时优先采用本地实现并保留本地源码闭包", async () => {
    // 建立本地已安装依赖包
    const linkedPkgRoot = join(projectRoot, "node_modules", "linked-pkg");
    mkdirSync(join(linkedPkgRoot, "actions"), { recursive: true });

    writeFileSync(
      join(linkedPkgRoot, "package.json"),
      JSON.stringify({ name: "linked-pkg", version: "1.0.0" }, null, 2),
      "utf-8"
    );
    writeFileSync(
      join(linkedPkgRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "linked-pkg",
          name: "Linked Package",
          version: "1.0.0",
          actions: {
            helper: {
              entry: "actions/helper.js",
              description: "local helper action",
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    writeFileSync(
      join(linkedPkgRoot, "actions", "helper.js"),
      "export default { run: async () => ({ local: true }) };",
      "utf-8"
    );

    // 主项目声明 manifest.dependencies 引入 linked-pkg，同时本地 bindings 也配置了 remote
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "main-pkg",
          name: "Main Package",
          version: "1.0.0",
          dependencies: {
            "linked-pkg": "^1.0.0",
          },
          actions: {
            caller: {
              entry: "actions/caller.js",
              description: "caller action",
              uses: ["linked-pkg/helper"],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, "actions", "caller.js"),
      "export default { run: async () => ({ ok: true }) };",
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, ".actiondock", "bindings.json"),
      JSON.stringify(
        {
          bindings: {
            "linked-pkg/helper": {
              primary: { type: "remote", profile: "remote-cluster" },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const plan = SelectionPlanner.plan({ projectRoot });

    // 本地优先：linked-pkg/helper 被识别为本地依赖闭包中的 action
    const helperDep = plan.actions.find((a) => a.id === "linked-pkg/helper");
    assert(helperDep !== undefined);
    assert.strictEqual(helperDep.isExternal, true);
    assert(helperDep.resolvedPath.includes(linkedPkgRoot));
    // 远端列表不包含该动作（本地源码回退生效）
    assert.deepStrictEqual(plan.remoteActionRefs, []);
  });

  it("导出产物保留 uses 且不夹带 bindings 与 profiles", async () => {
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "pkg.export-test",
          name: "Export Test",
          version: "1.0.0",
          actions: {
            process: {
              entry: "actions/process.js",
              description: "process with remote worker",
              uses: ["remote-svc/compute"],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, "actions", "process.js"),
      "export default { run: async () => ({ result: 42 }) };",
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, ".actiondock", "bindings.json"),
      JSON.stringify(
        {
          bindings: {
            "remote-svc/compute": {
              primary: { type: "remote", profile: "gpu-node" },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, ".actiondock", "profiles.json"),
      JSON.stringify({ profiles: { "gpu-node": { endpoint: "https://gpu.example.com", token: "secret" } } }),
      "utf-8"
    );

    const exportRes = await exportSkill({
      projectRoot,
      outDir,
      mode: "source",
    });

    assert.strictEqual(exportRes.packageId, "pkg.export-test");

    // 校验导出的 actiondock.json 清单
    const exportedManifestPath = join(outDir, "actiondock.json");
    assert(existsSync(exportedManifestPath));
    const exportedManifest = JSON.parse(readFileSync(exportedManifestPath, "utf-8"));

    // 原始 uses 声明严格保留
    assert.deepStrictEqual(exportedManifest.actions.process.uses, ["remote-svc/compute"]);

    // 杜绝运行配置与凭据泄漏
    assert.strictEqual(existsSync(join(outDir, ".actiondock")), false);
    assert.strictEqual(existsSync(join(outDir, ".actiondock", "bindings.json")), false);
    assert.strictEqual(existsSync(join(outDir, ".actiondock", "profiles.json")), false);
    assert.strictEqual(existsSync(join(outDir, "bindings.json")), false);
    assert.strictEqual(existsSync(join(outDir, "profiles.json")), false);
  });

  it("用户显式将运行配置指定为资产或文件时明确报错拦截", () => {
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "pkg.leak-attempt",
          name: "Leak Attempt",
          version: "1.0.0",
          actions: {
            noop: {
              entry: "actions/noop.js",
              description: "noop action",
            },
          },
          files: [".actiondock/bindings.json"],
        },
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, "actions", "noop.js"),
      "export default { run: async () => ({}) };",
      "utf-8"
    );

    writeFileSync(
      join(projectRoot, ".actiondock", "bindings.json"),
      JSON.stringify({ bindings: {} }),
      "utf-8"
    );

    assert.throws(
      () => SelectionPlanner.plan({ projectRoot }),
      (err: any) => {
        assert(err instanceof PlannerError);
        assert.strictEqual(err.code, "RESTRICTED_CONFIG_ASSET");
        return true;
      }
    );
  });

  it("外部依赖包独立读取其自身 bindings 配置且不继承主工程全局路由", async () => {
    const extPkgRoot = join(projectRoot, "node_modules", "ext-sub-pkg");
    mkdirSync(join(extPkgRoot, "actions"), { recursive: true });
    mkdirSync(join(extPkgRoot, ".actiondock"), { recursive: true });

    writeFileSync(
      join(extPkgRoot, "package.json"),
      JSON.stringify({ name: "ext-sub-pkg", version: "1.0.0" }, null, 2),
      "utf-8"
    );
    writeFileSync(
      join(extPkgRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "ext-sub-pkg",
          name: "External Sub Package",
          version: "1.0.0",
          actions: {
            worker: {
              entry: "actions/worker.js",
              description: "sub worker",
              uses: ["special-cloud/tool"],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    writeFileSync(
      join(extPkgRoot, "actions", "worker.js"),
      "export default { run: async () => ({}) };",
      "utf-8"
    );

    // 主工程依赖 ext-sub-pkg/worker，且主工程在自己的 bindings 中配置了 special-cloud/tool
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          id: "root-app",
          name: "Root App",
          version: "1.0.0",
          dependencies: {
            "ext-sub-pkg": "^1.0.0",
          },
          actions: {
            main: {
              entry: "actions/main.js",
              description: "main action",
              uses: ["ext-sub-pkg/worker"],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    writeFileSync(
      join(projectRoot, "actions", "main.js"),
      "export default { run: async () => ({}) };",
      "utf-8"
    );
    writeFileSync(
      join(projectRoot, ".actiondock", "bindings.json"),
      JSON.stringify(
        {
          bindings: {
            "special-cloud/tool": {
              primary: { type: "remote", profile: "root-cloud" },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    // 此时 ext-sub-pkg 自身并无 .actiondock/bindings.json 配置，不得继承主工程配置，必须报错
    assert.throws(
      () => SelectionPlanner.plan({ projectRoot }),
      (err: any) => {
        assert(err instanceof ActionDockError);
        assert(err.message.includes("special-cloud"));
        return true;
      }
    );

    // 当 ext-sub-pkg 在其自身项目根目录下配置了 bindings.json 时，规划成功通过
    writeFileSync(
      join(extPkgRoot, ".actiondock", "bindings.json"),
      JSON.stringify(
        {
          bindings: {
            "special-cloud/tool": {
              primary: { type: "remote", profile: "sub-cloud" },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const plan = SelectionPlanner.plan({ projectRoot });
    assert.deepStrictEqual(plan.remoteActionRefs, ["special-cloud/tool"]);
  });

  it("普通业务 bindings.json 仍可分发，私有运行目录与凭据文件被排除", () => {
    writeFileSync(join(projectRoot, "actiondock.json"), JSON.stringify({
      schemaVersion: 2, id: "pkg.assets", version: "1.0.0",
      actions: { noop: { entry: "actions/noop.js" } }, assets: ["data"],
    }));
    writeFileSync(join(projectRoot, "actions/noop.js"), "export default { run: () => ({}) };");
    mkdirSync(join(projectRoot, "data/.actiondock"), { recursive: true });
    writeFileSync(join(projectRoot, "data/bindings.json"), "{\"business\":true}");
    writeFileSync(join(projectRoot, "data/profiles.json"), "{\"token\":\"private\"}");
    writeFileSync(join(projectRoot, "data/.actiondock/bindings.json"), "{\"private\":true}");
    const plan = SelectionPlanner.plan({ projectRoot });
    const paths = plan.dependencies.modulesAndAssets.map((item) => item.path);
    assert.ok(paths.includes("data/bindings.json"));
    assert.equal(paths.some((path) => path.includes(".actiondock") || path.endsWith("profiles.json")), false);
  });

  it("多个调用方依赖同一远端引用时分别校验绑定，不能因去重跳过未绑定调用方", () => {
    writeFileSync(join(projectRoot, "actiondock.json"), JSON.stringify({
      schemaVersion: 2, id: "pkg.root", version: "1.0.0",
      dependencies: { "pkg.a": "^1.0.0", "pkg.b": "^1.0.0" },
      actions: { run: { entry: "actions/run.js", uses: ["pkg.a/work", "pkg.b/work"] } },
    }));
    writeFileSync(join(projectRoot, "actions/run.js"), "export default { run: () => ({}) };");
    for (const id of ["pkg.a", "pkg.b"]) {
      const root = join(projectRoot, "node_modules", id);
      mkdirSync(join(root, "actions"), { recursive: true });
      writeFileSync(join(root, "actiondock.json"), JSON.stringify({
        schemaVersion: 2, id, version: "1.0.0",
        actions: { work: { entry: "actions/work.js", uses: ["cloud-x/call"] } },
      }));
      writeFileSync(join(root, "actions/work.js"), "export default { run: () => ({}) };");
    }
    const bind = (id: string) => {
      const root = join(projectRoot, "node_modules", id, ".actiondock");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "bindings.json"), JSON.stringify({
        bindings: { "cloud-x/call": { primary: { type: "remote", profile: "office" } } },
      }));
    };
    bind("pkg.a");
    assert.throws(() => SelectionPlanner.plan({ projectRoot }), (error: any) => {
      assert.equal(error.code, "PACKAGE_NOT_FOUND");
      return true;
    });
    bind("pkg.b");
    const plan = SelectionPlanner.plan({ projectRoot });
    assert.deepEqual(plan.remoteActionRefs, ["cloud-x/call"]);
  });
});
