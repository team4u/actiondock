import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeManifestDigest } from "../src/project/digest";
import { saveLockfile, type ActionDockLockfile } from "../src/project/lockfile";
import { MANIFEST_FILE_NAME } from "../src/project/manifest";
import {
  ActionPackageResolver,
  ActionPackageVersionConflictError,
  UndeclaredActionDependencyError,
} from "../src/project/resolver";

describe("依赖解析器 ActionPackageResolver", () => {
  const tempDir = join(process.cwd(), ".tmp-resolver-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupPackage(
    dir: string,
    manifest: any,
    playbooks?: Record<string, { actions: string[]; content: string }>
  ) {
    if (playbooks) {
      manifest.playbooks = manifest.playbooks || {};
      for (const [name, pb] of Object.entries(playbooks)) {
        manifest.playbooks[name] = {
          entry: `playbooks/${name}.md`,
          actions: pb.actions,
        };
      }
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2));

    if (playbooks) {
      const pbDir = join(dir, "playbooks");
      mkdirSync(pbDir, { recursive: true });
      for (const [name, pb] of Object.entries(playbooks)) {
        writeFileSync(
          join(pbDir, `${name}.md`),
          pb.content
        );
      }
    }
  }

  it("成功解析直接依赖与传递依赖闭包", () => {
    const rootDir = join(tempDir, "root");
    const depBDir = join(tempDir, "node_modules", "pkg-b");
    const depCDir = join(tempDir, "node_modules", "pkg-c");

    const manifestC = { id: "pkg-c", version: "1.0.0", actions: { echo: { entry: "echo.ts" } } };
    setupPackage(depCDir, manifestC);

    const manifestB = {
      id: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-c": "^1.0.0" },
      actions: { forward: { entry: "forward.ts", uses: ["pkg-c/echo"] } },
    };
    setupPackage(depBDir, manifestB);

    const rootManifest = {
      id: "root-app",
      version: "1.0.0",
      dependencies: { "pkg-b": "^1.0.0" },
      actions: { main: { entry: "main.ts", uses: ["pkg-b/forward"] } },
    };
    setupPackage(rootDir, rootManifest);

    const lockfile: ActionDockLockfile = {
      lockfileVersion: 1,
      packages: {
        "pkg-b": {
          package: "pkg-b",
          resolved: "1.0.0",
          manifestDigest: computeManifestDigest(manifestB),
        },
        "pkg-c": {
          package: "pkg-c",
          resolved: "1.0.0",
          manifestDigest: computeManifestDigest(manifestC),
        },
      },
    };
    saveLockfile(rootDir, lockfile);

    const resolver = new ActionPackageResolver({ projectRoot: rootDir });
    const graph = resolver.resolveSync();

    expect(graph.rootPackageId).toBe("root-app");
    expect(graph.packages.has("pkg-b")).toBe(true);
    expect(graph.packages.has("pkg-c")).toBe(true);
    expect(graph.directDependencyIds.has("pkg-b")).toBe(true);
    expect(graph.transitiveDependencyIds.has("pkg-c")).toBe(true);
  });

  it("检测版本冲突并在不可收敛时抛出 ACTION_PACKAGE_VERSION_CONFLICT", () => {
    const rootDir = join(tempDir, "root");
    const depBDir = join(tempDir, "node_modules", "pkg-b");
    const depCDir = join(tempDir, "node_modules", "pkg-c");

    // pkg-b 要求 pkg-d 为 ^1.0.0
    setupPackage(depBDir, {
      id: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-d": "^1.0.0" },
    });

    // pkg-c 要求 pkg-d 为 ^2.0.0（冲突不可收敛）
    setupPackage(depCDir, {
      id: "pkg-c",
      version: "1.0.0",
      dependencies: { "pkg-d": "^2.0.0" },
    });

    setupPackage(rootDir, {
      id: "root-app",
      version: "1.0.0",
      dependencies: {
        "pkg-b": "^1.0.0",
        "pkg-c": "^1.0.0",
      },
    });

    const resolver = new ActionPackageResolver({ projectRoot: rootDir });
    expect(() => resolver.resolveSync()).toThrow(ActionPackageVersionConflictError);

    try {
      resolver.resolveSync();
    } catch (err: any) {
      expect(err.code).toBe("ACTION_PACKAGE_VERSION_CONFLICT");
      expect(err.packageId).toBe("pkg-d");
    }
  });

  it("拦截对传递包的未声明直接根调用", () => {
    const rootDir = join(tempDir, "root");
    const depBDir = join(tempDir, "node_modules", "pkg-b");
    const depCDir = join(tempDir, "node_modules", "pkg-c");

    setupPackage(depCDir, {
      id: "pkg-c",
      version: "1.0.0",
      actions: { secretAction: { entry: "secret.ts" } },
    });

    setupPackage(depBDir, {
      id: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-c": "^1.0.0" },
      actions: { runB: { entry: "run.ts" } },
    });

    setupPackage(rootDir, {
      id: "root-app",
      version: "1.0.0",
      dependencies: { "pkg-b": "^1.0.0" },
    });

    const resolver = new ActionPackageResolver({ projectRoot: rootDir });

    // 根包直接调用直接依赖 pkg-b 的 Action 允许
    expect(resolver.canRootCall("pkg-b", "runB")).toBe(true);

    // 根包未将 pkg-c 声明为直接依赖，且无可见 Playbook 委托，调用应被拒绝
    expect(resolver.canRootCall("pkg-c", "secretAction")).toBe(false);
    expect(() => resolver.assertRootCallAllowed("pkg-c", "secretAction")).toThrow(
      UndeclaredActionDependencyError
    );
  });

  it("当可见 Playbook 明确委托点名传递包的特定 Action 时允许根调用，其余 Action 依然受限", () => {
    const rootDir = join(tempDir, "root");
    const depBDir = join(tempDir, "node_modules", "pkg-b");
    const depCDir = join(tempDir, "node_modules", "pkg-c");

    setupPackage(depCDir, {
      id: "pkg-c",
      version: "1.0.0",
      actions: {
        check: { entry: "check.ts" },
        internalSecret: { entry: "secret.ts" },
      },
    });

    setupPackage(depBDir, {
      id: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-c": "^1.0.0" },
    });

    // 根包 Playbook 点名委托 pkg-c/check
    setupPackage(
      rootDir,
      {
        id: "root-app",
        version: "1.0.0",
        dependencies: { "pkg-b": "^1.0.0" },
        playbooks: {
          "run-check": {
            entry: "playbooks/run-check.md",
            actions: ["pkg-c/check"],
          },
        },
      },
      {
        "run-check": {
          actions: ["pkg-c/check"],
          content: "Run check from transitive package",
        },
      }
    );

    const resolver = new ActionPackageResolver({ projectRoot: rootDir });

    // 点名委托的 check 允许根调用
    expect(resolver.canRootCall("pkg-c", "check")).toBe(true);
    expect(() => resolver.assertRootCallAllowed("pkg-c", "check")).not.toThrow();

    // 未被委托的 internalSecret 依然被拦截
    expect(resolver.canRootCall("pkg-c", "internalSecret")).toBe(false);
    expect(() => resolver.assertRootCallAllowed("pkg-c", "internalSecret")).toThrow(
      UndeclaredActionDependencyError
    );
  });

  it("校验跨包级联调用必须在 uses 中显式声明", () => {
    const rootDir = join(tempDir, "root");
    const depBDir = join(tempDir, "node_modules", "pkg-b");

    setupPackage(depBDir, {
      id: "pkg-b",
      version: "1.0.0",
      actions: { helper: { entry: "helper.ts" } },
    });

    setupPackage(rootDir, {
      id: "root-app",
      version: "1.0.0",
      dependencies: { "pkg-b": "^1.0.0" },
      actions: {
        declaredAction: {
          entry: "declared.ts",
          uses: ["pkg-b/helper"],
        },
        undeclaredAction: {
          entry: "undeclared.ts",
          uses: [],
        },
      },
    });

    const resolver = new ActionPackageResolver({ projectRoot: rootDir });

    // 声明了 uses 的调用允许
    expect(resolver.canCascadeCall("root-app", "declaredAction", "pkg-b", "helper")).toBe(true);
    expect(() =>
      resolver.assertCascadeCallAllowed("root-app", "declaredAction", "pkg-b", "helper")
    ).not.toThrow();

    // 未声明 uses 的调用拦截
    expect(resolver.canCascadeCall("root-app", "undeclaredAction", "pkg-b", "helper")).toBe(false);
    expect(() =>
      resolver.assertCascadeCallAllowed("root-app", "undeclaredAction", "pkg-b", "helper")
    ).toThrow(UndeclaredActionDependencyError);
  });
});
