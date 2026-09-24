import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { traverseDirectory } from "../src/utils";
import { discoverActionFiles } from "../src/project/loader";

/**
 * traverseDirectory 目录遍历单一事实源契约测试。
 *
 * 覆盖三类防护场景（软链接越界、循环软链接、node_modules 忽略），
 * 并断言消费该实现的各链路（builder 归档收集、相对文件收集、规划扫描、
 * core 清单扫描）与原语行为一致。
 */

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ad-traverse-test-"));
}

describe("traverseDirectory 单一事实源契约", () => {
  it("常规递归收集文件与目录条目并按名称排序", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "alpha"), { recursive: true });
      mkdirSync(join(dir, "beta"), { recursive: true });
      writeFileSync(join(dir, "root.txt"), "root");
      writeFileSync(join(dir, "alpha", "one.ts"), "1");
      writeFileSync(join(dir, "beta", "two.ts"), "2");

      const files = traverseDirectory(dir).map((e) => e.relPath);
      expect(files).toEqual(["alpha/one.ts", "beta/two.ts", "root.txt"]);

      const withDirs = traverseDirectory(dir, { includeDirs: true }).map((e) => e.relPath);
      expect(withDirs).toEqual(["alpha", "alpha/one.ts", "beta", "beta/two.ts", "root.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("忽略谓词生效且被忽略目录不再下钻", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "node_modules", "some-pkg"), { recursive: true });
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "some-pkg", "index.js"), "nm");
      writeFileSync(join(dir, "src", "main.ts"), "src");
      writeFileSync(join(dir, "src", "main.test.ts"), "test");

      const files = traverseDirectory(dir, {
        ignore: (relPath) => relPath.startsWith("node_modules/") || relPath.endsWith(".test.ts"),
      }).map((e) => e.relPath);

      expect(files).toEqual(["src/main.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("越出根边界的软链接被跳过且不中断遍历", () => {
    const base = makeTempDir();
    const dir = join(base, "root");
    try {
      mkdirSync(join(base, "outside"), { recursive: true });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(base, "outside", "secret.txt"), "outside");
      writeFileSync(join(dir, "inside.txt"), "inside");
      // POSIX 与 Windows（junction 不支持文件）均以目录软链接验证
      symlinkSync(join(base, "outside"), join(dir, "escape"), process.platform === "win32" ? "junction" : "dir");

      const files = traverseDirectory(dir).map((e) => e.relPath);
      expect(files).toEqual(["inside.txt"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("循环软链接被拦截且不产生死循环", () => {
    const base = makeTempDir();
    const dir = join(base, "root");
    try {
      mkdirSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "sub", "file.txt"), "data");
      // 指向祖先目录的循环软链接
      symlinkSync(dir, join(dir, "sub", "loop"), process.platform === "win32" ? "junction" : "dir");

      const files = traverseDirectory(dir).map((e) => e.relPath);
      expect(files).toEqual(["sub/file.txt"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("不存在的目录返回空结果", () => {
    expect(traverseDirectory(join(tmpdir(), "ad-traverse-nonexistent-dir"))).toEqual([]);
  });
});

describe("消费方链路一致性契约", () => {
  /**
   * 构造共享测试目录：node_modules 目录、普通源码目录与可选软链接。
   */
  function buildSharedTree(withSymlinks: boolean): { base: string; root: string; outside: string } {
    const base = makeTempDir();
    const root = join(base, "pkg");
    const outside = join(base, "outside");
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
    mkdirSync(join(root, "actions"), { recursive: true });
    mkdirSync(join(root, "assets"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "node_modules", "dep", "index.js"), "nm");
    writeFileSync(join(root, "actions", "greet.ts"), "action");
    writeFileSync(join(root, "assets", "logo.png"), "png");
    writeFileSync(join(outside, "secret.txt"), "outside");
    if (withSymlinks) {
      symlinkSync(outside, join(root, "assets", "escape"), process.platform === "win32" ? "junction" : "dir");
    }
    return { base, root, outside };
  }

  it("软链接越界场景下各消费链路结果一致", async () => {
    const { base, root } = buildSharedTree(true);
    try {
      // 链路一：core 原语（忽略 node_modules）
      const primitive = traverseDirectory(root, {
        ignore: (relPath) => relPath.startsWith("node_modules/"),
      }).map((e) => e.relPath);

      // 链路二：builder 相对文件收集（fs-utils.collectRelativeFiles）
      const { collectRelativeFiles } = await import("../../builder/src/fs-utils");
      const collected = collectRelativeFiles(root).filter((f) => !f.startsWith("node_modules/"));

      // 链路三：builder 归档条目收集（archive 内部 collectEntries 经压缩产物验证，剔除目录条目后与文件链路对齐）
      const { createZipArchiveAsync } = await import("../../builder/src/archive");
      const { readZipEntries } = await import("../../builder/test/archive-reader");
      const zipPath = join(base, "out.zip");
      await createZipArchiveAsync(root, zipPath);
      const zipContents = readZipEntries(zipPath);
      const archived = Array.from(zipContents.entries())
        .map(([name, content]) => ({ rel: name.split("/").slice(1).join("/"), isDir: content === null }))
        .filter((e) => e.rel.length > 0 && !e.rel.startsWith("node_modules") && !e.isDir)
        .map((e) => e.rel);

      expect(primitive.sort()).toEqual(collected.sort());
      expect(collected.sort()).toEqual(archived.sort());
      // 越界软链接条目与目标内容均不出现
      expect(primitive).not.toContain("assets/escape/secret.txt");
      expect(primitive).toContain("actions/greet.ts");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("循环软链接场景下各消费链路结果一致", async () => {
    const { base, root } = buildSharedTree(false);
    try {
      // 根目录内制造指向祖先的循环软链接
      symlinkSync(root, join(root, "assets", "loop"), process.platform === "win32" ? "junction" : "dir");

      const primitive = traverseDirectory(root, {
        ignore: (relPath) => relPath.startsWith("node_modules/"),
      }).map((e) => e.relPath);

      const { collectRelativeFiles } = await import("../../builder/src/fs-utils");
      const collected = collectRelativeFiles(root).filter((f) => !f.startsWith("node_modules/"));
      expect(primitive.sort()).toEqual(collected.sort());
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("node_modules 忽略场景下 planner 扫描与 core 清单扫描行为一致", () => {
    const { base, root } = buildSharedTree(false);
    try {
      // 链路一：core 原语带 node_modules 忽略
      const primitive = traverseDirectory(root, {
        ignore: (relPath) => relPath.startsWith("node_modules/"),
      }).map((e) => e.relPath);

      // 链路二：core loader 的 scanFiles（经 discoverActionFiles 触达）
      const actionFiles = discoverActionFiles(root);
      const loaderRels = actionFiles.map((f) => relative(root, f).replace(/\\/g, "/"));

      // loader 仅收集 .ts 且排除测试文件，对应原语的过滤子集
      const primitiveTs = primitive.filter((f) => f.endsWith(".ts"));
      expect(loaderRels.sort()).toEqual(primitiveTs.sort());
      // node_modules 内的 .js 不进入任何链路
      expect(loaderRels).toEqual(["actions/greet.ts"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
