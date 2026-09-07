import { readFileSync } from "node:fs";
import { gunzipSync, inflateRawSync } from "node:zlib";

/**
 * 归档解包读取器（仅供单元测试验证使用）。
 *
 * 纯 Node 代码解析 zip 与 tar.gz，不依赖任何外部解压命令，
 * 保证测试在 Windows 与最小化 Linux 环境下行为一致。
 */

/** 归档内条目：路径 → 内容（目录条目内容为 null） */
export type ArchiveContents = Map<string, Buffer | null>;

/** 去除右侧 NUL 与空白的定长字符串字段 */
function readStringField(buf: Buffer, start: number, length: number): string {
  return buf.toString("utf8", start, start + length).replace(/\0+$/, "").trimEnd();
}

/** 解析八进制字符串字段（NUL / 空格结尾） */
function readOctalField(buf: Buffer, start: number, length: number): number {
  const text = buf.toString("ascii", start, start + length).replace(/[\0 ]+$/, "");
  return text ? parseInt(text, 8) : 0;
}

/**
 * 解析 zip 归档（PKZIP APPNOTE 结构）。
 *
 * 从文件尾部定位 EOCD，遍历 central directory 定位各条目 local header，
 * stored 条目直读、deflate 条目经 inflateRawSync 解压。
 */
export function readZipEntries(zipPath: string): ArchiveContents {
  const buf = readFileSync(zipPath);
  const contents: ArchiveContents = new Map();

  // 尾部搜索 EOCD 签名（理论最大偏移 22 + 65535 注释）
  let eocd = -1;
  const searchStart = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("zip EOCD record not found");
  }

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error(`zip central directory signature mismatch at ${ptr}`);
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    if (name.endsWith("/")) {
      contents.set(name.slice(0, -1), null);
    } else {
      // 定位 local header 数据区（30 字节头 + 文件名 + 扩展字段）
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compressedSize);
      contents.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return contents;
}

/**
 * 解析 tar.gz 归档（USTAR 格式）。
 *
 * gzip 解压后按 512 字节块遍历头部，typeflag 5 为目录、0 为普通文件，
 * 遇全零块即到达归档结尾。
 */
export function readTarGzEntries(tarGzPath: string): ArchiveContents {
  const buf = gunzipSync(readFileSync(tarGzPath));
  const contents: ArchiveContents = new Map();

  let offset = 0;
  while (offset + 512 <= buf.length) {
    const block = buf.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) {
      break;
    }

    const name = readStringField(block, 0, 100);
    const size = readOctalField(block, 124, 12);
    const typeflag = String.fromCharCode(block[156]);
    const prefix = readStringField(block, 345, 155);
    const fullPath = prefix ? `${prefix}/${name}` : name;

    if (typeflag === "5") {
      contents.set(fullPath, null);
    } else if (typeflag === "0" || typeflag === "\0") {
      contents.set(fullPath, Buffer.from(buf.subarray(offset + 512, offset + 512 + size)));
    }

    // 步进：头块 + 数据块（补齐 512 对齐）
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return contents;
}
