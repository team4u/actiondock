import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertPathWithinRoot,
  assertWithinProjectRoot,
  isPathOutsideBoundary,
} from "../src/utils";

describe("路径边界与越界判定测试套件", () => {
  describe("isPathOutsideBoundary 单元判定", () => {
    it("正确判定越界路径为 true", () => {
      assert.strictEqual(isPathOutsideBoundary(".."), true);
      assert.strictEqual(isPathOutsideBoundary("../"), true);
      assert.strictEqual(isPathOutsideBoundary("../outside.ts"), true);
      assert.strictEqual(isPathOutsideBoundary("../../outside.ts"), true);
      assert.strictEqual(isPathOutsideBoundary("..\\"), true);
      assert.strictEqual(isPathOutsideBoundary("..\\outside.ts"), true);
      assert.strictEqual(isPathOutsideBoundary("/etc/passwd"), true);
    });

    it("正确判定根目录内合法路径与带双点前缀目录为 false", () => {
      assert.strictEqual(isPathOutsideBoundary(""), false);
      assert.strictEqual(isPathOutsideBoundary("."), false);
      assert.strictEqual(isPathOutsideBoundary("index.ts"), false);
      assert.strictEqual(isPathOutsideBoundary("src/index.ts"), false);
      assert.strictEqual(isPathOutsideBoundary("..cache"), false);
      assert.strictEqual(isPathOutsideBoundary("..cache/file.ts"), false);
      assert.strictEqual(isPathOutsideBoundary("..cache\\file.ts"), false);
      assert.strictEqual(isPathOutsideBoundary("nested/..cache/file.ts"), false);
      assert.strictEqual(isPathOutsideBoundary("..data"), false);
      assert.strictEqual(isPathOutsideBoundary("..output/dist/bundle.js"), false);
    });
  });

  describe("assertPathWithinRoot 边界安全断言", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ad-utils-boundary-test-"));
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("允许根目录内常规文件及 ..cache 等双点命名的子目录和文件", () => {
      const cacheDir = join(tempDir, "..cache");
      mkdirSync(cacheDir, { recursive: true });
      const cacheFile = join(cacheDir, "entry.ts");
      writeFileSync(cacheFile, "export const ok = true;");

      assert.doesNotThrow(() => assertPathWithinRoot(tempDir, cacheDir));
      assert.doesNotThrow(() => assertPathWithinRoot(tempDir, cacheFile));
      assert.doesNotThrow(() => assertPathWithinRoot(tempDir, "..cache/entry.ts"));
      assert.doesNotThrow(() => assertPathWithinRoot(tempDir, "..cache"));
    });

    it("拦截向上逃逸的越界相对路径与绝对路径", () => {
      assert.throws(() => assertPathWithinRoot(tempDir, ".."), /escapes boundary/);
      assert.throws(() => assertPathWithinRoot(tempDir, "../outside.ts"), /escapes boundary/);
      assert.throws(() => assertPathWithinRoot(tempDir, "../../outside.ts"), /escapes boundary/);
      assert.throws(() => assertPathWithinRoot(tempDir, join(tempDir, "..", "outside.ts")), /escapes boundary/);
    });

    it("支持根目录内指向合法文件（包括 ..cache 目录内）的软链接", () => {
      const cacheDir = join(tempDir, "..cache");
      mkdirSync(cacheDir, { recursive: true });
      const targetFile = join(cacheDir, "real-target.txt");
      writeFileSync(targetFile, "target");

      const linkFile = join(tempDir, "link-to-target.txt");
      symlinkSync(targetFile, linkFile);

      assert.doesNotThrow(() => assertPathWithinRoot(tempDir, linkFile));
      assert.doesNotThrow(() => assertPathWithinRoot(tempDir, "link-to-target.txt"));
    });

    it("拦截指向根目录外部的越界软链接", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "ad-utils-outside-"));
      try {
        const outsideTarget = join(outsideDir, "outside.txt");
        writeFileSync(outsideTarget, "secret");

        const linkToOutside = join(tempDir, "symlink-to-outside.txt");
        symlinkSync(outsideTarget, linkToOutside);

        assert.throws(() => assertPathWithinRoot(tempDir, linkToOutside), 
          /symlink resolves outside boundary/
        );
        assert.throws(() => assertPathWithinRoot(tempDir, "symlink-to-outside.txt"), 
          /symlink resolves outside boundary/
        );
      } finally {
        if (existsSync(outsideDir)) {
          rmSync(outsideDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("assertWithinProjectRoot 边界安全断言", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ad-utils-project-test-"));
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("允许合法子目录包括 ..cache", () => {
      assert.doesNotThrow(() => assertWithinProjectRoot(tempDir, "..cache", "actionsDir"));
      assert.doesNotThrow(() => assertWithinProjectRoot(tempDir, "..cache/actions", "actionsDir"));
      assert.doesNotThrow(() => assertWithinProjectRoot(tempDir, "actions", "actionsDir"));
    });

    it("拒绝绝对路径与越界路径", () => {
      assert.throws(() => assertWithinProjectRoot(tempDir, resolve(tempDir, "actions"), "actionsDir"), 
        /cannot be an absolute path/
      );
      assert.throws(() => assertWithinProjectRoot(tempDir, "../actions", "actionsDir"), 
        /escapes boundary/
      );
    });
  });
});
