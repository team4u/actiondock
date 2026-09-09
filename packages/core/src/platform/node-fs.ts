import { promises as fs } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { assertPathWithinRoot } from "../utils";
import type { FileStat, FileSystem } from "./types";

/**
 * NodeFileSystem 配置选项。
 */
export interface NodeFileSystemOptions {
  /**
   * 安全沙箱根路径。
   * 若指定，则所有文件系统操作将被强制约束在 rootDir 边界内，防止路径遍历逃逸。
   */
  rootDir?: string;
}

/**
 * 基于 node:fs 和 node:path 的安全受限文件系统实现。
 */
export class NodeFileSystem implements FileSystem {
  private readonly rootDir?: string;

  constructor(options: NodeFileSystemOptions = {}) {
    if (options.rootDir) {
      this.rootDir = resolve(options.rootDir);
    }
  }

  /**
   * 安全解析并校验路径边界。
   */
  private resolvePath(targetPath: string): string {
    if (typeof targetPath !== "string" || targetPath.includes("\0")) {
      throw new Error("Invalid path: contains null byte or non-string argument");
    }

    if (this.rootDir) {
      const resolved = isAbsolute(targetPath)
        ? resolve(targetPath)
        : resolve(this.rootDir, targetPath);
      assertPathWithinRoot(this.rootDir, resolved);
      return resolved;
    }

    return resolve(targetPath);
  }

  async readFile(path: string, encoding: string = "utf-8"): Promise<string> {
    const resolved = this.resolvePath(path);
    return await fs.readFile(resolved, { encoding: (encoding || "utf-8") as BufferEncoding });
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const resolved = this.resolvePath(path);
    const parentDir = dirname(resolved);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(resolved, content);
  }

  async readdir(dir: string): Promise<string[]> {
    const resolved = this.resolvePath(dir);
    return await fs.readdir(resolved);
  }

  async stat(path: string): Promise<FileStat> {
    const resolved = this.resolvePath(path);
    const s = await fs.stat(resolved);
    return {
      isDirectory: () => s.isDirectory(),
      isFile: () => s.isFile(),
      size: s.size,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      const resolved = this.resolvePath(path);
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dir: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolvePath(dir);
    await fs.mkdir(resolved, { recursive: options?.recursive ?? true });
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const resolved = this.resolvePath(path);
    await fs.rm(resolved, {
      recursive: options?.recursive ?? true,
      force: options?.force ?? true,
    });
  }

  async copy(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> {
    const resolvedSrc = this.resolvePath(src);
    const resolvedDest = this.resolvePath(dest);
    const parentDir = dirname(resolvedDest);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.cp(resolvedSrc, resolvedDest, { recursive: options?.recursive ?? true });
  }
}
