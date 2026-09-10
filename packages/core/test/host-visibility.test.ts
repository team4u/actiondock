import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createActionDockHost } from "../src/host";
import { computeManifestDigest } from "../src/project/digest";
import { saveLockfile, type ActionDockLockfile } from "../src/project/lockfile";
import { MANIFEST_FILE_NAME } from "../src/project/manifest";

describe("Host 多包依赖可见性与锁文件加载集成", () => {
  const tempDir = join(process.cwd(), ".tmp-host-visibility-" + Date.now());

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupPackage(
    dir: string,
    manifest: any,
    actionHandlers?: Record<string, string>,
    playbooks?: Record<string, { actions: string[]; content: string }>
  ) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2));

    if (actionHandlers) {
      const actDir = join(dir, "actions");
      mkdirSync(actDir, { recursive: true });
      for (const [name, code] of Object.entries(actionHandlers)) {
        writeFileSync(join(actDir, `${name}.ts`), code);
      }
    }

    if (playbooks) {
      const pbDir = join(dir, "playbooks");
      mkdirSync(pbDir, { recursive: true });
      for (const [name, pb] of Object.entries(playbooks)) {
        writeFileSync(
          join(pbDir, `${name}.md`),
          `---\nid: ${name}\nactions:\n${pb.actions.map((a) => `  - "${a}"`).join("\n")}\n---\n${pb.content}`
        );
      }
    }
  }

  it("宿主容器依据锁文件与声明加载外部包，严格实施根调用与委托可见性控制", async () => {
    const rootDir = join(tempDir, "root");
    const depBDir = join(rootDir, "node_modules", "pkg-b");
    const depCDir = join(rootDir, "node_modules", "pkg-c");

    // 传递依赖包 pkg-c
    const manifestC = {
      id: "pkg-c",
      version: "1.0.0",
      actions: {
        "c-echo": { entry: "actions/c-echo.ts" },
        "c-secret": { entry: "actions/c-secret.ts" },
      },
    };
    setupPackage(depCDir, manifestC, {
      "c-echo": "export default function run(input: any) { return { echo: input?.text || 'hello' }; }",
      "c-secret": "export default function run() { return { secret: '42' }; }",
    });

    // 直接依赖包 pkg-b
    const manifestB = {
      id: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-c": "^1.0.0" },
      actions: {
        "b-action": { entry: "actions/b-action.ts" },
        "b-cascade-declared": {
          entry: "actions/b-cascade-declared.ts",
          uses: ["pkg-c/c-echo"],
        },
        "b-cascade-undeclared": {
          entry: "actions/b-cascade-undeclared.ts",
          uses: [],
        },
      },
    };
    setupPackage(depBDir, manifestB, {
      "b-action": "export default function run() { return { ok: true }; }",
      "b-cascade-declared":
        "export default async function run(input: any, ctx: any) { return ctx.actions.invoke('pkg-c/c-echo', { text: 'cascaded' }); }",
      "b-cascade-undeclared":
        "export default async function run(input: any, ctx: any) { return ctx.actions.invoke('pkg-c/c-echo', { text: 'illegal' }); }",
    });

    // 根工程 root-app，在 Playbook 中点名委托 pkg-c/c-echo
    const rootManifest = {
      id: "root-app",
      version: "1.0.0",
      dependencies: { "pkg-b": "^1.0.0" },
      actions: {
        main: { entry: "actions/main.ts" },
      },
      playbooks: {
        "run-c": {
          entry: "playbooks/run-c.md",
          actions: ["pkg-c/c-echo"],
        },
      },
    };
    setupPackage(
      rootDir,
      rootManifest,
      {
        main: "export default function run() { return { root: true }; }",
      },
      {
        "run-c": {
          actions: ["pkg-c/c-echo"],
          content: "Delegated Playbook running pkg-c/c-echo",
        },
      }
    );

    // 写入锁文件
    const lockfile: ActionDockLockfile = {
      lockfileVersion: 2,
      packages: {
        "pkg-b": {
          packageId: "pkg-b",
          npmPackage: "pkg-b",
          version: "1.0.0",
          resolved: "1.0.0",
          manifestDigest: computeManifestDigest(manifestB),
        },
        "pkg-c": {
          packageId: "pkg-c",
          npmPackage: "pkg-c",
          version: "1.0.0",
          resolved: "1.0.0",
          manifestDigest: computeManifestDigest(manifestC),
        },
      },
    };
    saveLockfile(rootDir, lockfile);

    const host = await createActionDockHost({
      projectRoot: rootDir,
      inMemory: true,
    });

    // 验证 listActions 仅对外暴露：根包、直接依赖包，以及被可见 Playbook 委托的 Action
    const actions = await host.listActions();
    const actionIds = actions.map((a) => a.id);

    expect(actionIds).toContain("root-app/main");
    expect(actionIds).toContain("pkg-b/b-action");
    expect(actionIds).toContain("pkg-c/c-echo"); // 被 run-c Playbook 精确委托点名暴露
    expect(actionIds).not.toContain("pkg-c/c-secret"); // 未被委托，不对外可见

    // 验证根调用：委托的 pkg-c/c-echo 允许调用
    const resEcho = await host.runAction("pkg-c/c-echo", { text: "world" });
    expect(resEcho.ok).toBe(true);
    if (resEcho.ok) {
      expect((resEcho.data as any)?.echo).toBe("world");
    }

    // 验证根调用：未声明直接依赖且未委托的 pkg-c/c-secret 严格拦截
    const resSecret = await host.runAction("pkg-c/c-secret", {});
    expect(resSecret.ok).toBe(false);
    if (!resSecret.ok) {
      expect(resSecret.error?.code).toBe("UNDECLARED_ACTION_DEPENDENCY");
    }

    // 验证级联调用：已声明 uses 的调用成功
    const resCascadeOk = await host.runAction("pkg-b/b-cascade-declared", {});
    expect(resCascadeOk.ok).toBe(true);

    // 验证级联调用：未声明 uses 的调用拦截
    const resCascadeFail = await host.runAction("pkg-b/b-cascade-undeclared", {});
    expect(resCascadeFail.ok).toBe(false);
    if (!resCascadeFail.ok) {
      expect(resCascadeFail.error?.code).toBe("UNDECLARED_ACTION_DEPENDENCY");
    }

    await host.close();
  });

  it("当依赖存在不可收敛版本冲突时 Host 初始化抛出 ACTION_PACKAGE_VERSION_CONFLICT", async () => {
    const rootDir = join(tempDir, "root-conflict");
    const depBDir = join(rootDir, "node_modules", "pkg-b");
    const depCDir = join(rootDir, "node_modules", "pkg-c");

    setupPackage(depBDir, {
      id: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-d": "^1.0.0" },
    });

    setupPackage(depCDir, {
      id: "pkg-c",
      version: "1.0.0",
      dependencies: { "pkg-d": "^2.0.0" },
    });

    setupPackage(rootDir, {
      id: "root-conflict",
      version: "1.0.0",
      dependencies: {
        "pkg-b": "^1.0.0",
        "pkg-c": "^1.0.0",
      },
    });

    expect(
      createActionDockHost({
        projectRoot: rootDir,
        inMemory: true,
      })
    ).rejects.toThrow(/ACTION_PACKAGE_VERSION_CONFLICT/);
  });

  it("当存在崩溃遗留的悬空事务时 Host 启动自动恢复旧快照", async () => {
    const rootDir = join(tempDir, "root-recovery");
    mkdirSync(rootDir, { recursive: true });

    const originalManifest = {
      id: "root-recovery",
      version: "1.0.0",
      name: "original",
    };
    writeFileSync(join(rootDir, MANIFEST_FILE_NAME), JSON.stringify(originalManifest, null, 2));

    // 构造模拟崩溃前生成的悬空事务
    const txDir = join(rootDir, ".actiondock", "transactions", "crash-tx-1");
    const snapDir = join(txDir, "snapshot");
    mkdirSync(snapDir, { recursive: true });

    // 快照中保存的是 originalManifest
    writeFileSync(join(snapDir, MANIFEST_FILE_NAME), JSON.stringify(originalManifest, null, 2));
    writeFileSync(
      join(txDir, "transaction.json"),
      JSON.stringify(
        {
          id: "crash-tx-1",
          status: "pending",
          createdAt: Date.now(),
          files: [{ name: MANIFEST_FILE_NAME, existed: true }],
        },
        null,
        2
      )
    );

    // 模拟破坏性写入
    writeFileSync(
      join(rootDir, MANIFEST_FILE_NAME),
      JSON.stringify({ id: "root-recovery", version: "damaged" }, null, 2)
    );

    // 启动 Host
    const host = await createActionDockHost({
      projectRoot: rootDir,
      inMemory: true,
    });

    // 验证崩溃快照已恢复
    const restored = JSON.parse(
      readFileSync(join(rootDir, MANIFEST_FILE_NAME), "utf-8")
    );
    expect(restored.version).toBe("1.0.0");
    expect(restored.name).toBe("original");

    await host.close();
  });
});
