import { existsSync, rmSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createTarGzArchiveAsync, createZipArchiveAsync } from "./archive";
import { BuilderError } from "./errors";
import type { ArchiveFormat } from "./types";

/**
 * 导出产物归档辅助层。
 *
 * 归档压缩能力的单一事实源在 ./archive，此处仅承载面向导出流程的
 * 目标路径推导与临时文件清理语义，严禁重复实现压缩逻辑。
 */

/**
 * 执行归档压缩操作。
 * 先压缩到临时路径，成功后原子重命名覆盖最终路径；失败时清理临时文件后透传原始异常，
 * 避免旧档已删、新档半成品残留的中间态。
 */
export async function createArchive(skillDir: string, format: ArchiveFormat): Promise<string> {
  const parentDir = dirname(skillDir);
  const folderName = basename(skillDir);
  const archiveName = `${folderName}.${format === "tar.gz" ? "tar.gz" : "zip"}`;
  const archivePath = join(parentDir, archiveName);
  const tempArchivePath = `${archivePath}.tmp`;

  if (existsSync(tempArchivePath)) {
    // 清理上次失败可能残留的临时文件（兼容目录形态，避免阻塞本次压缩）
    rmSync(tempArchivePath, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 });
  }

  try {
    if (format === "tar.gz") {
      await createTarGzArchiveAsync(skillDir, tempArchivePath);
    } else {
      await createZipArchiveAsync(skillDir, tempArchivePath);
    }
    renameSync(tempArchivePath, archivePath);
  } catch (err: any) {
    // 压缩失败：清理临时半成品，旧档保持原样，透传原始异常
    if (existsSync(tempArchivePath)) {
      rmSync(tempArchivePath, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 });
    }
    throw new BuilderError(`Failed to create ${format} archive: ${err?.message || String(err)}`);
  }

  return archivePath;
}

/**
 * 解析归档格式：显式 archiveFormat 优先，archive 字段直接携带格式时其次。
 */
export function resolveArchiveFormat(options: {
  archive?: boolean | ArchiveFormat;
  archiveFormat?: ArchiveFormat;
}): ArchiveFormat {
  if (options.archiveFormat === "tar.gz" || options.archive === "tar.gz") {
    return "tar.gz";
  }
  return "zip";
}
