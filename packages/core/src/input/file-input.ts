import { open, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  inputFileNotFound,
  inputFileReadFailed,
  inputLimitExceeded,
} from "./flat-errors";

/** 默认最大输入字节数限制（10MB） */
export const DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * 安全打开的常规文件描述句柄包装。
 */
export interface OpenedRegularFile {
  /** 底层 Node.js 文件句柄 */
  readonly handle: FileHandle;
  /** 文件路径 */
  readonly path: string;
  /** 文件元信息 */
  readonly stat: Stats;
  /** 文件字节大小 */
  readonly size: number;
  /**
   * 在指定字节上限约束下读取文件完整内容。
   *
   * @param maxInputBytes 最大允许读取字节数
   * @param signal 可选的中断信号
   * @returns 读取的文件内容 Buffer
   */
  readBounded(maxInputBytes: number, signal?: AbortSignal): Promise<Buffer>;
  /**
   * 关闭文件句柄，释放操作系统文件描述符。
   */
  close(): Promise<void>;
}

/**
 * 安全打开常规输入文件。
 *
 * 安全契约：
 * - 最终打开目标必须为 regular file（允许普通文件及指向普通文件的符号链接 symlink）。
 * - 严厉拒绝目录、FIFO 管道、socket、字符设备与块设备等，抛出 INPUT_FILE_READ_FAILED（reason: "UNSUPPORTED_FILE_TYPE"）。
 * - 完美支持 AbortSignal 取消。若信号在 open 完成前触发，执行逻辑取消；若 open 滞后成功，立即执行 handle.close() 关闭句柄，严防文件描述符泄漏。
 * - 大小预检与有界读取：当文件大小超出 maxInputBytes 时抛出 INPUT_LIMIT_EXCEEDED（reason: "MAX_INPUT_BYTES"）。
 *
 * @param filePath 输入文件路径
 * @param signal 可选的取消信号
 * @returns 包装后的常规文件句柄对象
 */
export async function openRegularInputFile(
  filePath: string,
  signal?: AbortSignal
): Promise<OpenedRegularFile> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
  }

  let handle: FileHandle | undefined;
  let aborted = false;

  const onAbort = () => {
    aborted = true;
    if (handle) {
      handle.close().catch(() => {});
    }
  };

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    try {
      handle = await open(filePath, "r");
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        throw inputFileNotFound(filePath);
      }
      throw inputFileReadFailed(filePath, err);
    }

    // 若在 open 等待期间触发 abort，立即关闭滞后打开的句柄并中止
    if (aborted || signal?.aborted) {
      await handle.close().catch(() => {});
      throw signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
    }

    let stat: Stats;
    try {
      stat = await handle.stat();
    } catch (err: any) {
      await handle.close().catch(() => {});
      throw inputFileReadFailed(filePath, err);
    }

    if (aborted || signal?.aborted) {
      await handle.close().catch(() => {});
      throw signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
    }

    // 严厉校验目标是否为常规文件（排除目录、FIFO、socket、设备等）
    if (!stat.isFile()) {
      await handle.close().catch(() => {});
      throw inputFileReadFailed(filePath, new Error("Unsupported file type"), {
        reason: "UNSUPPORTED_FILE_TYPE",
      });
    }

    let isClosed = false;
    const openedFile: OpenedRegularFile = {
      handle,
      path: filePath,
      stat,
      size: stat.size,
      close: async () => {
        if (!isClosed) {
          isClosed = true;
          await handle!.close().catch(() => {});
        }
      },
      readBounded: async (maxInputBytes: number, readSignal?: AbortSignal) => {
        const effectiveSignal = readSignal ?? signal;
        if (effectiveSignal?.aborted) {
          throw effectiveSignal.reason ?? new DOMException("The operation was aborted", "AbortError");
        }

        // 大小预检：若 stat.size 明确超过上限，直接拦截
        if (stat.size > maxInputBytes) {
          throw inputLimitExceeded(
            `File size (${stat.size} bytes) exceeds limit of ${maxInputBytes} bytes`,
            { reason: "MAX_INPUT_BYTES" }
          );
        }

        // 分配有界缓冲区（多读 1 字节以探测并发写入扩大的竞态）
        const buffer = Buffer.alloc(Math.min(stat.size, maxInputBytes) + 1);
        const { bytesRead } = await handle!.read(buffer, 0, buffer.length, 0);

        if (effectiveSignal?.aborted) {
          throw effectiveSignal.reason ?? new DOMException("The operation was aborted", "AbortError");
        }

        if (bytesRead > maxInputBytes) {
          throw inputLimitExceeded(
            `File read size (${bytesRead} bytes) exceeds limit of ${maxInputBytes} bytes`,
            { reason: "MAX_INPUT_BYTES" }
          );
        }

        return buffer.subarray(0, bytesRead);
      },
    };

    return openedFile;
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * 以有界大小限制安全读取常规文件的全部内容并自动关闭句柄。
 *
 * @param filePath 输入文件路径
 * @param options 读取配置选项
 * @returns 文件的原始字节 Buffer
 */
export async function readRegularFileBounded(
  filePath: string,
  options?: {
    maxInputBytes?: number;
    signal?: AbortSignal;
  }
): Promise<Buffer> {
  const maxBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const opened = await openRegularInputFile(filePath, options?.signal);
  try {
    return await opened.readBounded(maxBytes, options?.signal);
  } finally {
    await opened.close();
  }
}
