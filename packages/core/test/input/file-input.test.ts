import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openRegularInputFile,
  readRegularFileBounded,
} from "../../src/input/file-input";
import {
  InputError,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
  INPUT_LIMIT_EXCEEDED,
} from "../../src/input/flat-errors";

describe("常规文件输入有界读取 openRegularInputFile", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ad-test-file-input-"));

  it("正常打开并读取常规文件内容", async () => {
    const filePath = join(tempDir, "regular.json");
    writeFileSync(filePath, '{"hello":"world"}', "utf8");

    const opened = await openRegularInputFile(filePath);
    expect(opened.path).toBe(filePath);
    expect(opened.size).toBe(17);

    const content = await opened.readBounded(1024);
    expect(content.toString("utf8")).toBe('{"hello":"world"}');
    await opened.close();
  });

  it("支持指向常规文件的符号链接（symlink）", async () => {
    const targetFile = join(tempDir, "target.txt");
    writeFileSync(targetFile, "symlink-target-content", "utf8");

    const linkPath = join(tempDir, "link-to-target.txt");
    symlinkSync(targetFile, linkPath);

    const opened = await openRegularInputFile(linkPath);
    expect(opened.size).toBe(22);

    const content = await opened.readBounded(1024);
    expect(content.toString("utf8")).toBe("symlink-target-content");
    await opened.close();
  });

  it("拒绝目录路径并抛出 UNSUPPORTED_FILE_TYPE", async () => {
    try {
      await openRegularInputFile(tempDir);
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_FILE_READ_FAILED);
      expect(err.details?.reason).toBe("UNSUPPORTED_FILE_TYPE");
    }
  });

  it("文件不存在时抛出 INPUT_FILE_NOT_FOUND", async () => {
    const missing = join(tempDir, "non-existent-file.json");
    try {
      await openRegularInputFile(missing);
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_FILE_NOT_FOUND);
      expect(err.message).toContain("non-existent-file.json");
    }
  });

  it("当文件大小超过 maxInputBytes 时抛出 INPUT_LIMIT_EXCEEDED", async () => {
    const largeFile = join(tempDir, "large.txt");
    writeFileSync(largeFile, "1234567890", "utf8"); // 10 字节

    const opened = await openRegularInputFile(largeFile);
    try {
      await opened.readBounded(5); // 限制 5 字节
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_LIMIT_EXCEEDED);
      expect(err.details?.reason).toBe("MAX_INPUT_BYTES");
    } finally {
      await opened.close();
    }
  });

  it("已取消的 AbortSignal 在打开前立即中止", async () => {
    const filePath = join(tempDir, "abort.txt");
    writeFileSync(filePath, "data", "utf8");

    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));

    await expect(
      openRegularInputFile(filePath, controller.signal)
    ).rejects.toThrow("pre-aborted");
  });

  it("打开期间接收取消信号能够关闭已创建的 handle 防范泄漏", async () => {
    const filePath = join(tempDir, "race-abort.txt");
    writeFileSync(filePath, "data-content", "utf8");

    const controller = new AbortController();
    // 异步触发 abort
    queueMicrotask(() => controller.abort(new Error("cancelled-during-open")));

    await expect(
      openRegularInputFile(filePath, controller.signal)
    ).rejects.toThrow();
  });

  it("readRegularFileBounded 自动完成打开、有界读取与句柄关闭", async () => {
    const filePath = join(tempDir, "auto-close.txt");
    writeFileSync(filePath, "auto-close-data", "utf8");

    const buf = await readRegularFileBounded(filePath, { maxInputBytes: 100 });
    expect(buf.toString("utf8")).toBe("auto-close-data");
  });
});
