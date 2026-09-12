import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
      expect(isPathOutsideBoundary("..")).toBe(true);
      expect(isPathOutsideBoundary("../")).toBe(true);
      expect(isPathOutsideBoundary("../outside.ts")).toBe(true);
      expect(isPathOutsideBoundary("../../outside.ts")).toBe(true);
      expect(isPathOutsideBoundary("..\\")).toBe(true);
      expect(isPathOutsideBoundary("..\\outside.ts")).toBe(true);
      expect(isPathOutsideBoundary("/etc/passwd")).toBe(true);
    });

    it("正确判定根目录内合法路径与带双点前缀目录为 false", () => {
      expect(isPathOutsideBoundary("")).toBe(false);
      expect(isPathOutsideBoundary(".")).toBe(false);
      expect(isPathOutsideBoundary("index.ts")).toBe(false);
      expect(isPathOutsideBoundary("src/index.ts")).toBe(false);
      expect(isPathOutsideBoundary("..cache")).toBe(false);
      expect(isPathOutsideBoundary("..cache/file.ts")).toBe(false);
      expect(isPathOutsideBoundary("..cache\\file.ts")).toBe(false);
      expect(isPathOutsideBoundary("nested/..cache/file.ts")).toBe(false);
      expect(isPathOutsideBoundary("..data")).toBe(false);
      expect(isPathOutsideBoundary("..output/dist/bundle.js")).toBe(false);
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

      expect(() => assertPathWithinRoot(tempDir, cacheDir)).not.toThrow();
      expect(() => assertPathWithinRoot(tempDir, cacheFile)).not.toThrow();
      expect(() => assertPathWithinRoot(tempDir, "..cache/entry.ts")).not.toThrow();
      expect(() => assertPathWithinRoot(tempDir, "..cache")).not.toThrow();
    });

    it("拦截向上逃逸的越界相对路径与绝对路径", () => {
      expect(() => assertPathWithinRoot(tempDir, "..")).toThrow(/escapes boundary/);
      expect(() => assertPathWithinRoot(tempDir, "../outside.ts")).toThrow(/escapes boundary/);
      expect(() => assertPathWithinRoot(tempDir, "../../outside.ts")).toThrow(/escapes boundary/);
      expect(() => assertPathWithinRoot(tempDir, join(tempDir, "..", "outside.ts"))).toThrow(/escapes boundary/);
    });

    it("支持根目录内指向合法文件（包括 ..cache 目录内）的软链接", () => {
      const cacheDir = join(tempDir, "..cache");
      mkdirSync(cacheDir, { recursive: true });
      const targetFile = join(cacheDir, "real-target.txt");
      writeFileSync(targetFile, "target");

      const linkFile = join(tempDir, "link-to-target.txt");
      symlinkSync(targetFile, linkFile);

      expect(() => assertPathWithinRoot(tempDir, linkFile)).not.toThrow();
      expect(() => assertPathWithinRoot(tempDir, "link-to-target.txt")).not.toThrow();
    });

    it("拦截指向根目录外部的越界软链接", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "ad-utils-outside-"));
      try {
        const outsideTarget = join(outsideDir, "outside.txt");
        writeFileSync(outsideTarget, "secret");

        const linkToOutside = join(tempDir, "symlink-to-outside.txt");
        symlinkSync(outsideTarget, linkToOutside);

        expect(() => assertPathWithinRoot(tempDir, linkToOutside)).toThrow(
          /symlink resolves outside boundary/
        );
        expect(() => assertPathWithinRoot(tempDir, "symlink-to-outside.txt")).toThrow(
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
      expect(() => assertWithinProjectRoot(tempDir, "..cache", "actionsDir")).not.toThrow();
      expect(() => assertWithinProjectRoot(tempDir, "..cache/actions", "actionsDir")).not.toThrow();
      expect(() => assertWithinProjectRoot(tempDir, "actions", "actionsDir")).not.toThrow();
    });

    it("拒绝绝对路径与越界路径", () => {
      expect(() => assertWithinProjectRoot(tempDir, resolve(tempDir, "actions"), "actionsDir")).toThrow(
        /cannot be an absolute path/
      );
      expect(() => assertWithinProjectRoot(tempDir, "../actions", "actionsDir")).toThrow(
        /escapes boundary/
      );
    });
  });
});
