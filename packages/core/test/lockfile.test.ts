import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeManifestDigest } from "../src/project/digest";
import {
  loadLockfile,
  saveLockfile,
  validateLockfile,
  type ActionDockLockfile,
} from "../src/project/lockfile";
import { MANIFEST_FILE_NAME } from "../src/project/manifest";

describe("锁文件 actiondock.lock.json 读写与校验", () => {
  const tempDir = join(process.cwd(), ".tmp-lockfile-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("当锁文件不存在时 loadLockfile 返回 null", () => {
    expect(loadLockfile(tempDir)).toBeNull();
  });

  it("正确保存并读取锁文件且 packages 保持字母排序", () => {
    const lockfile: ActionDockLockfile = {
      lockfileVersion: 2,
      packages: {
        "z-package": {
          packageId: "z-package",
          npmPackage: "@org/z-package",
          version: "1.0.0",
          resolved: "1.0.0",
          manifestDigest: "sha256-abc",
        },
        "a-package": {
          packageId: "a-package",
          npmPackage: "@org/a-package",
          version: "2.1.0",
          resolved: "2.1.0",
          manifestDigest: "sha256-def",
          dependencies: {
            "dep-b": "1.0.0",
            "dep-a": "2.0.0",
          },
        },
      },
    };

    saveLockfile(tempDir, lockfile);
    const loaded = loadLockfile(tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.lockfileVersion).toBe(2);

    const keys = Object.keys(loaded?.packages || {});
    expect(keys).toEqual(["a-package", "z-package"]);

    const aDeps = Object.keys(loaded?.packages["a-package"].dependencies || {});
    expect(aDeps).toEqual(["dep-a", "dep-b"]);
  });

  it("校验锁文件格式合法性", () => {
    const validLock: ActionDockLockfile = {
      lockfileVersion: 2,
      packages: {
        "my.package": {
          packageId: "my.package",
          npmPackage: "@scope/my.package",
          version: "1.0.0",
          resolved: "1.0.0",
          manifestDigest: "sha256-123456",
        },
      },
    };

    const res = validateLockfile(validLock);
    expect(res.valid).toBe(true);
    expect(res.errors).toBeUndefined();

    const invalidVersion = { ...validLock, lockfileVersion: 1 };
    const resInvalid = validateLockfile(invalidVersion);
    expect(resInvalid.valid).toBe(false);
    expect(resInvalid.errors?.[0]).toContain("lockfileVersion");
  });

  it("当 actiondock.json 清单变更导致与记录的 manifestDigest 不匹配时校验失败", () => {
    const depDir = join(tempDir, "node_modules", "@someone", "github-actions");
    mkdirSync(depDir, { recursive: true });

    const manifestV1 = {
      id: "someone.github-actions",
      version: "1.0.0",
      actions: {
        "get-pr": { entry: "actions/get-pr.ts" },
      },
    };
    writeFileSync(join(depDir, MANIFEST_FILE_NAME), JSON.stringify(manifestV1, null, 2));
    const digestV1 = computeManifestDigest(manifestV1);

    const lockfile: ActionDockLockfile = {
      lockfileVersion: 2,
      packages: {
        "someone.github-actions": {
          packageId: "someone.github-actions",
          npmPackage: "@someone/github-actions",
          version: "1.0.0",
          resolved: "1.0.0",
          manifestDigest: digestV1,
        },
      },
    };

    // 初始状态下校验通过
    const check1 = validateLockfile(lockfile, { projectRoot: tempDir });
    expect(check1.valid).toBe(true);

    // 修改依赖包的 actiondock.json，模拟未经重新解析的变动
    const manifestV2 = {
      ...manifestV1,
      version: "1.0.1",
    };
    writeFileSync(join(depDir, MANIFEST_FILE_NAME), JSON.stringify(manifestV2, null, 2));

    const check2 = validateLockfile(lockfile, { projectRoot: tempDir });
    expect(check2.valid).toBe(false);
    expect(check2.errors?.[0]).toContain("Manifest digest mismatch");
    expect(check2.errors?.[0]).toContain("Re-resolution required");
  });
});
