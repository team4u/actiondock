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
      lockfileVersion: 1,
      packages: {
        "z-package": {
          package: "@org/z-package",
          resolved: "1.0.0",
          manifestDigest: "sha256-abc",
        },
        "a-package": {
          package: "@org/a-package",
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
    expect(loaded?.lockfileVersion).toBe(1);

    const keys = Object.keys(loaded?.packages || {});
    expect(keys).toEqual(["a-package", "z-package"]);

    const aDeps = Object.keys(loaded?.packages["a-package"].dependencies || {});
    expect(aDeps).toEqual(["dep-a", "dep-b"]);
  });

  it("校验锁文件格式合法性", () => {
    const validLock: ActionDockLockfile = {
      lockfileVersion: 1,
      packages: {
        "my.package": {
          package: "@scope/my.package",
          resolved: "1.0.0",
          manifestDigest: "sha256-123456",
        },
      },
    };

    const res = validateLockfile(validLock);
    expect(res.valid).toBe(true);
    expect(res.errors).toBeUndefined();

    const invalidVersion = { ...validLock, lockfileVersion: 99 as any };
    const resInvalid = validateLockfile(invalidVersion);
    expect(resInvalid.valid).toBe(false);
    expect(resInvalid.errors?.[0]).toContain("lockfileVersion");
  });

  it("validateLockfile 严格校验非对象根结构与 packages 字段", () => {
    expect(validateLockfile(null).valid).toBe(false);
    expect(validateLockfile(undefined).valid).toBe(false);
    expect(validateLockfile("string").valid).toBe(false);
    expect(validateLockfile([]).valid).toBe(false);
    expect(validateLockfile(123).valid).toBe(false);

    const noPackages = validateLockfile({ lockfileVersion: 1 });
    expect(noPackages.valid).toBe(false);
    expect(noPackages.errors?.some((e) => e.includes("'packages' must be an object"))).toBe(true);

    const arrayPackages = validateLockfile({ lockfileVersion: 1, packages: [] });
    expect(arrayPackages.valid).toBe(false);
    expect(arrayPackages.errors?.some((e) => e.includes("'packages' must be an object"))).toBe(true);

    const nullPackages = validateLockfile({ lockfileVersion: 1, packages: null });
    expect(nullPackages.valid).toBe(false);
    expect(nullPackages.errors?.some((e) => e.includes("'packages' must be an object"))).toBe(true);
  });

  it("validateLockfile 严格校验 package、resolved 与 manifestDigest 必填字段及条目类型", () => {
    // 条目不是对象
    const nonObjectEntry = validateLockfile({
      lockfileVersion: 1,
      packages: {
        "pkg-a": "not-an-object" as any,
        "pkg-b": null as any,
      },
    });
    expect(nonObjectEntry.valid).toBe(false);
    expect(nonObjectEntry.errors?.some((e) => e.includes("Package entry 'pkg-a' must be an object"))).toBe(true);
    expect(nonObjectEntry.errors?.some((e) => e.includes("Package entry 'pkg-b' must be an object"))).toBe(true);

    // 缺少 package 字段
    const missingPackage = validateLockfile({
      lockfileVersion: 1,
      packages: {
        "pkg-a": {
          resolved: "1.0.0",
          manifestDigest: "sha256-abc",
        } as any,
      },
    });
    expect(missingPackage.valid).toBe(false);
    expect(missingPackage.errors?.some((e) => e.includes("missing required string property 'package'"))).toBe(true);

    // 缺少 resolved 字段
    const missingResolved = validateLockfile({
      lockfileVersion: 1,
      packages: {
        "pkg-a": {
          package: "@org/pkg-a",
          manifestDigest: "sha256-abc",
        } as any,
      },
    });
    expect(missingResolved.valid).toBe(false);
    expect(missingResolved.errors?.some((e) => e.includes("missing required string property 'resolved'"))).toBe(true);

    // 缺少 manifestDigest 字段
    const missingDigest = validateLockfile({
      lockfileVersion: 1,
      packages: {
        "pkg-a": {
          package: "@org/pkg-a",
          resolved: "1.0.0",
        } as any,
      },
    });
    expect(missingDigest.valid).toBe(false);
    expect(missingDigest.errors?.some((e) => e.includes("missing required string property 'manifestDigest'"))).toBe(true);
  });

  it("loadLockfile 在文件损坏、版本不支持或结构非法时抛出明确异常", () => {
    const lockfilePath = join(tempDir, "actiondock.lock.json");

    // 1. JSON 格式损坏
    writeFileSync(lockfilePath, "{ invalid json content ...", "utf-8");
    expect(() => loadLockfile(tempDir)).toThrow(/Corrupted or duplicate keys in lockfile/);

    // 2. JSON 包含重复键
    writeFileSync(
      lockfilePath,
      JSON.stringify({ lockfileVersion: 1, packages: {} })
        .replace("}", ', "lockfileVersion": 1}'),
      "utf-8"
    );
    expect(() => loadLockfile(tempDir)).toThrow(/Corrupted or duplicate keys in lockfile/);

    // 3. 根结构不是对象（例如 JSON 数组）
    writeFileSync(lockfilePath, JSON.stringify([1, 2, 3]), "utf-8");
    expect(() => loadLockfile(tempDir)).toThrow(/Invalid lockfile format.*expected a JSON object/);

    // 4. lockfileVersion 不是 1（例如版本 2 或 99）
    writeFileSync(
      lockfilePath,
      JSON.stringify({ lockfileVersion: 2, packages: {} }),
      "utf-8"
    );
    expect(() => loadLockfile(tempDir)).toThrow(/Unsupported lockfileVersion.*received '2', expected 1/);

    // 5. packages 字段缺失或非对象
    writeFileSync(
      lockfilePath,
      JSON.stringify({ lockfileVersion: 1, packages: [1, 2, 3] }),
      "utf-8"
    );
    expect(() => loadLockfile(tempDir)).toThrow(/Invalid lockfile format.*'packages' must be an object/);

    writeFileSync(
      lockfilePath,
      JSON.stringify({ lockfileVersion: 1 }),
      "utf-8"
    );
    expect(() => loadLockfile(tempDir)).toThrow(/Invalid lockfile format.*'packages' must be an object/);
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
      lockfileVersion: 1,
      packages: {
        "someone.github-actions": {
          package: "@someone/github-actions",
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
