import { closeSync, createReadStream, createWriteStream, existsSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createDeflateRaw, deflateRawSync, gzipSync, createGzip } from "node:zlib";
import { basename, join, relative, sep } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertPathWithinRoot } from "@actiondock/core";

/**
 * 纯 Node 实现的归档压缩模块。
 *
 * zip 与 tar.gz 均在进程内完成打包，不依赖宿主机的 zip / tar 命令行工具
 * （Windows 与最小化 Linux 环境普遍缺少 zip 命令）。
 * 压缩能力复用 node:zlib 内置的 deflateRaw（zip 条目）与 gzip（tar.gz 容器）。
 */

/** 目录内相对路径条目（目录在前、同级按名称排序，保证归档内容顺序稳定） */
interface ArchiveEntry {
  /** 相对根目录的 POSIX 风格路径（目录以 / 结尾仅出现在 zip 条目名层面） */
  relPath: string;
  /** 是否为目录 */
  isDir: boolean;
}

/** 递归收集目录内全部条目，执行安全路径边界校验与符号链接循环拦截 */
function collectEntries(dir: string, baseDir = dir, visited = new Set<string>()): ArchiveEntry[] {
  if (!existsSync(dir)) return [];
  if (visited.size === 0) {
    try {
      visited.add(existsSync(baseDir) ? realpathSync(baseDir) : baseDir);
    } catch {
      // 忽略
    }
  }
  const entries: ArchiveEntry[] = [];
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  for (const name of names) {
    const fullPath = join(dir, name);
    try {
      assertPathWithinRoot(baseDir, fullPath, "archive path");
    } catch {
      continue;
    }

    let real: string;
    try {
      real = existsSync(fullPath) ? realpathSync(fullPath) : fullPath;
    } catch {
      continue;
    }

    try {
      assertPathWithinRoot(baseDir, real, "archive path");
    } catch {
      // 忽略并跳过指向 baseDir 外部的软链接
      continue;
    }

    if (visited.has(real)) {
      continue;
    }
    visited.add(real);

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        entries.push({ relPath: relative(baseDir, fullPath).split(sep).join("/"), isDir: true });
        entries.push(...collectEntries(fullPath, baseDir, visited));
      } else if (stat.isFile()) {
        entries.push({ relPath: relative(baseDir, fullPath).split(sep).join("/"), isDir: false });
      }
    } catch {
      // 忽略无法访问或损坏的文件/符号链接
      continue;
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* zip 格式写入                                                        */
/* ------------------------------------------------------------------ */

/** CRC32 查表（IEEE 802.3 多项式） */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, buf: Buffer): number {
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc;
}

function crc32(buf: Buffer): number {
  return (updateCrc32(0xffffffff, buf) ^ 0xffffffff) >>> 0;
}

/** Unix 毫秒时间戳转 DOS 时间格式（date/time 各 16 位） */
function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms);
  const year = Math.max(d.getFullYear(), 1980);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { date, time };
}

/** central directory 记录（写入 EOCD 前聚合） */
interface ZipCentralRecord {
  header: Buffer;
  localOffset: number;
}

/**
 * 将目录打包为标准 zip 归档（PKZIP APPNOTE 结构）。
 * 直接流式分块写入磁盘，避免在内存中积压全量归档内容。
 *
 * @param dir 待打包目录（目录名即归档内根文件夹名）
 * @param outPath 输出 zip 文件路径
 */
export function createZipArchive(dir: string, outPath: string): void {
  const rootName = basename(dir);
  const entries = collectEntries(dir);
  const fd = openSync(outPath, "w");
  const centralRecords: ZipCentralRecord[] = [];
  let offset = 0;

  try {
    for (const entry of entries) {
      // 归档内路径带根目录前缀；目录条目名以 / 结尾
      const name = `${rootName}/${entry.relPath}${entry.isDir ? "/" : ""}`;
      const nameBuf = Buffer.from(name, "utf8");
      const stat = statSync(join(dir, entry.relPath));
      const { date, time } = dosDateTime(stat.mtimeMs);
      const content = entry.isDir ? Buffer.alloc(0) : readFileSync(join(dir, entry.relPath));

      let method = 0;
      let payload = content;
      if (!entry.isDir && content.length > 0) {
        const deflated = deflateRawSync(content, { level: 9 });
        if (deflated.length < content.length) {
          method = 8;
          payload = deflated;
        }
      }

      const crc = crc32(content);

      // Local File Header（30 字节 + 文件名）
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 文件名标志
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(payload.length, 18);
      local.writeUInt32LE(content.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);

      writeSync(fd, local);
      writeSync(fd, nameBuf);
      if (payload.length > 0) {
        writeSync(fd, payload);
      }

      // Central Directory Header（46 字节 + 文件名）
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix + ZIP 2.0
      central.writeUInt16LE(20, 6); // version needed
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(method, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(date, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(payload.length, 20);
      central.writeUInt32LE(content.length, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt16LE(0, 30); // extra len
      central.writeUInt16LE(0, 32); // comment len
      central.writeUInt16LE(0, 34); // disk start
      central.writeUInt16LE(0, 36); // internal attrs
      // 外部属性：Unix 权限左移 16 位，目录附加 MS-DOS 目录位
      const isExec =
        !entry.isDir &&
        (Boolean(stat.mode & 0o111) || entry.relPath.includes("bin/") || entry.relPath.startsWith("bin/"));
      const fileMode = isExec ? 0o100755 : 0o100644;
      const extAttrs = ((entry.isDir ? 0o40755 : fileMode) << 16) | (entry.isDir ? 0x10 : 0);
      central.writeUInt32LE(extAttrs >>> 0, 38);
      central.writeUInt32LE(offset, 42);
      centralRecords.push({ header: Buffer.concat([central, nameBuf]), localOffset: offset });

      offset += local.length + nameBuf.length + payload.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const record of centralRecords) {
      writeSync(fd, record.header);
      centralDirSize += record.header.length;
    }

    // End of Central Directory Record（22 字节）
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(centralRecords.length, 8);
    eocd.writeUInt16LE(centralRecords.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment len
    writeSync(fd, eocd);
  } finally {
    closeSync(fd);
  }
}

/**
 * 向可写流安全写入数据块，严格处理背压与流异常。
 * 当 stream.write 返回 false 时挂起等待 drain 事件触发；
 * 若流销毁或出错则安全拒绝。
 */
export async function writeToStream(stream: Writable, chunk: Buffer): Promise<void> {
  if (stream.destroyed || (stream as { errored?: Error | null }).errored) {
    throw (stream as { errored?: Error | null }).errored ?? new Error("Target stream has been destroyed");
  }
  const canWrite = stream.write(chunk);
  if (!canWrite) {
    if (stream.destroyed || (stream as { errored?: Error | null }).errored) {
      throw (stream as { errored?: Error | null }).errored ?? new Error("Target stream has been destroyed");
    }
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        if (stream.destroyed && !stream.writableEnded) {
          reject((stream as { errored?: Error | null }).errored ?? new Error("Target stream closed prematurely"));
        } else {
          resolve();
        }
      };
      const cleanup = () => {
        stream.off("drain", onDrain);
        stream.off("error", onError);
        stream.off("close", onClose);
      };
      stream.once("drain", onDrain);
      stream.once("error", onError);
      stream.once("close", onClose);
    });
  }
}

/**
 * 异步流式 zip 归档：基于 PKZIP Data Descriptor 规范实现真正流式打包，
 * 逐文件流式读取与增量压缩写入磁盘，避免在内存中积压全量原文件与压缩内容。
 */
export async function createZipArchiveAsync(dir: string, outPath: string): Promise<void> {
  const rootName = basename(dir);
  const entries = collectEntries(dir);
  const out = createWriteStream(outPath, { highWaterMark: 1024 * 1024 });

  // 本地片段（头 + 内容）逐段写入，同步计算 central directory 记录所需的偏移
  interface PendingCentral {
    header: Buffer;
  }
  const centralRecords: PendingCentral[] = [];
  let offset = 0;

  const writeChunk = async (chunk: Buffer): Promise<void> => {
    offset += chunk.length;
    await writeToStream(out, chunk);
  };

  try {
    for (const entry of entries) {
      const name = `${rootName}/${entry.relPath}${entry.isDir ? "/" : ""}`;
      const nameBuf = Buffer.from(name, "utf8");
      const fullPath = join(dir, entry.relPath);
      const stat = statSync(fullPath);
      const { date, time } = dosDateTime(stat.mtimeMs);

      // 外部属性：Unix 权限左移 16 位，目录附加 MS-DOS 目录位
      const isExec =
        !entry.isDir &&
        (Boolean(stat.mode & 0o111) || entry.relPath.includes("bin/") || entry.relPath.startsWith("bin/"));
      const fileMode = isExec ? 0o100755 : 0o100644;
      const extAttrs = ((entry.isDir ? 0o40755 : fileMode) << 16) | (entry.isDir ? 0x10 : 0);

      const localOffset = offset;
      const isDeflatedFile = !entry.isDir && stat.size > 0;
      const method = isDeflatedFile ? 8 : 0;
      const flag = isDeflatedFile ? 0x0808 : 0x0800;

      // Local File Header（30 字节 + 文件名）
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(flag, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(0, 14); // bit 3 开启或空文件/目录置 0
      local.writeUInt32LE(0, 18); // bit 3 开启或空文件/目录置 0
      local.writeUInt32LE(0, 22); // bit 3 开启或空文件/目录置 0
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);

      await writeChunk(local);
      await writeChunk(nameBuf);

      let fileCrc = 0;
      let fileCompressedSize = 0;
      let fileUncompressedSize = 0;

      if (isDeflatedFile) {
        let crcState = 0xffffffff;
        let uncompressedSize = 0;
        let compressedSize = 0;

        const crcTransform = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            crcState = updateCrc32(crcState, buf);
            uncompressedSize += buf.length;
            callback(null, buf);
          },
        });

        const deflater = createDeflateRaw({ level: 9 });

        const outWritable = new Writable({
          async write(chunk: Buffer, _encoding, callback) {
            try {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              compressedSize += buf.length;
              await writeChunk(buf);
              callback();
            } catch (err) {
              callback(err as Error);
            }
          },
        });

        const fileStream = createReadStream(fullPath);
        await pipeline(fileStream, crcTransform, deflater, outWritable);

        fileCrc = (crcState ^ 0xffffffff) >>> 0;
        fileCompressedSize = compressedSize;
        fileUncompressedSize = uncompressedSize;

        // Data Descriptor（16 字节）：0x08074b50 + CRC32 + compressedSize + uncompressedSize
        const dd = Buffer.alloc(16);
        dd.writeUInt32LE(0x08074b50, 0);
        dd.writeUInt32LE(fileCrc, 4);
        dd.writeUInt32LE(fileCompressedSize, 8);
        dd.writeUInt32LE(fileUncompressedSize, 12);
        await writeChunk(dd);
      }

      // Central Directory Header（46 字节 + 文件名）
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix + ZIP 2.0
      central.writeUInt16LE(20, 6); // version needed
      central.writeUInt16LE(flag, 8);
      central.writeUInt16LE(method, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(date, 14);
      central.writeUInt32LE(fileCrc, 16);
      central.writeUInt32LE(fileCompressedSize, 20);
      central.writeUInt32LE(fileUncompressedSize, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt16LE(0, 30); // extra len
      central.writeUInt16LE(0, 32); // comment len
      central.writeUInt16LE(0, 34); // disk start
      central.writeUInt16LE(0, 36); // internal attrs
      central.writeUInt32LE(extAttrs >>> 0, 38);
      central.writeUInt32LE(localOffset, 42);
      centralRecords.push({ header: Buffer.concat([central, nameBuf]) });
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const record of centralRecords) {
      await writeChunk(record.header);
      centralDirSize += record.header.length;
    }

    // End of Central Directory Record（22 字节）
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(centralRecords.length, 8);
    eocd.writeUInt16LE(centralRecords.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment len
    await writeChunk(eocd);

    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.once("error", reject);
    });
  } catch (err) {
    out.destroy();
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* tar.gz 格式写入                                                     */
/* ------------------------------------------------------------------ */

/**
 * 构造单个条目的 USTAR 头块（512 字节）。
 * 路径超长时按 USTAR prefix 字段拆分，仍放不下则抛错。
 */
function tarHeader(
  path: string,
  size: number,
  mtimeSec: number,
  isDir: boolean,
  modeOrExec: string | boolean = false
): Buffer {
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(name, "utf8") > 100) {
    const trailingSlash = name.endsWith("/");
    const cleanPath = trailingSlash ? name.slice(0, -1) : name;
    const split = cleanPath.lastIndexOf("/");
    prefix = cleanPath.slice(0, split);
    name = cleanPath.slice(split + 1) + (trailingSlash ? "/" : "");
    if (split <= 0 || Buffer.byteLength(prefix, "utf8") > 155 || Buffer.byteLength(name, "utf8") > 100) {
      throw new Error(`归档路径超出 USTAR 字段容量: ${path}`);
    }
  }

  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, "utf8");
  let mode: string;
  if (typeof modeOrExec === "string") {
    mode = modeOrExec;
  } else {
    mode = isDir ? "0000755" : (modeOrExec ? "0000755" : "0000644");
  }
  buf.write(mode, 100, 8, "ascii"); // mode
  buf.write("0000000", 108, 8, "ascii"); // uid
  buf.write("0000000", 116, 8, "ascii"); // gid
  buf.write(size.toString(8).padStart(11, "0"), 124, 12, "ascii"); // size
  buf.write(Math.floor(mtimeSec).toString(8).padStart(11, "0"), 136, 12, "ascii"); // mtime
  buf.fill(" ", 148, 156); // chksum 占位（计算时视为空格）
  buf.write(isDir ? "5" : "0", 156, 1, "ascii"); // typeflag
  buf.write("ustar\0", 257, 6, "ascii"); // magic
  buf.write("00", 263, 2, "ascii"); // version
  if (prefix) buf.write(prefix, 345, 155, "utf8");

  // 校验和：整块字节的无符号累加和，写作 6 位八进制 + NUL + 空格
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, "0"), 148, 7, "ascii");
  buf.write("\0", 154, 1, "ascii");
  buf.write(" ", 155, 1, "ascii");
  return buf;
}

/** 将字节数补齐到 512 的整数倍 */
function pad512(length: number): Buffer {
  const rem = length % 512;
  return rem === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - rem);
}

/**
 * 将目录打包为标准 tar.gz 归档（USTAR + gzip）。
 *
 * @param dir 待打包目录（目录名即归档内根文件夹名）
 * @param outPath 输出 tar.gz 文件路径
 */
export function createTarGzArchive(dir: string, outPath: string): void {
  const rootName = basename(dir);
  const entries = collectEntries(dir);
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const path = `${rootName}/${entry.relPath}${entry.isDir ? "/" : ""}`;
    const fullPath = join(dir, entry.relPath);
    const stat = statSync(fullPath);
    const content = entry.isDir ? Buffer.alloc(0) : readFileSync(fullPath);
    const isExec =
      !entry.isDir &&
      (Boolean(stat.mode & 0o111) || entry.relPath.includes("bin/") || entry.relPath.startsWith("bin/"));

    chunks.push(
      tarHeader(
        path,
        content.length,
        Math.floor(stat.mtimeMs / 1000),
        entry.isDir,
        isExec
      )
    );
    if (!entry.isDir) {
      chunks.push(content, pad512(content.length));
    }
  }

  // 归档结尾：两个全零块
  chunks.push(Buffer.alloc(1024));

  writeFileSync(outPath, gzipSync(Buffer.concat(chunks), { level: 9 }));
}

/** tar.gz 异步流式归档配置选项 */
export interface TarGzArchiveOptions {
  /** 自定义可读流创建器，默认使用 node:fs 的 createReadStream */
  createReadStream?: (path: string) => Readable;
  /** 自定义可写流创建器，默认使用 node:fs 的 createWriteStream */
  createWriteStream?: (path: string) => Writable;
  /** 自定义 gzip 转换流创建器，默认使用 node:zlib 的 createGzip */
  createGzip?: () => Transform;
  /** 自定义 gzip 压缩级别，默认值为 9 */
  level?: number;
}

/**
 * 将目录异步流式打包为标准 tar.gz 归档（USTAR 与 gzip 流），避免在内存中积压全量原文件与压缩内容。
 * 严格基于 Node.js 异步流背压机制与错误传播链路实现。
 *
 * @param dir 待打包目录
 * @param outPath 输出 tar.gz 文件路径
 * @param options 归档配置选项
 */
export async function createTarGzArchiveAsync(
  dir: string,
  outPath: string,
  options?: TarGzArchiveOptions
): Promise<void> {
  const rootName = basename(dir);
  const entries = collectEntries(dir);
  const gzip = options?.createGzip ? options.createGzip() : createGzip({ level: options?.level ?? 9 });
  const getWriteStream = options?.createWriteStream ?? createWriteStream;
  const getReadStream = options?.createReadStream ?? createReadStream;
  const writeStream = getWriteStream(outPath);
  const pipePromise = pipeline(gzip, writeStream);
  pipePromise.catch(() => {});

  try {
    for (const entry of entries) {
      const path = `${rootName}/${entry.relPath}${entry.isDir ? "/" : ""}`;
      const fullPath = join(dir, entry.relPath);
      const stat = statSync(fullPath);
      const isExec =
        !entry.isDir &&
        (Boolean(stat.mode & 0o111) || entry.relPath.includes("bin/") || entry.relPath.startsWith("bin/"));

      const header = tarHeader(
        path,
        entry.isDir ? 0 : stat.size,
        Math.floor(stat.mtimeMs / 1000),
        entry.isDir,
        isExec
      );
      await writeToStream(gzip, header);

      if (!entry.isDir && stat.size > 0) {
        const fileStream = getReadStream(fullPath);
        const onGzipError = (err: Error) => {
          if ("destroy" in fileStream && typeof fileStream.destroy === "function") {
            fileStream.destroy(err);
          }
        };
        gzip.once("error", onGzipError);
        try {
          for await (const chunk of fileStream) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            await writeToStream(gzip, buf);
          }
        } finally {
          gzip.off("error", onGzipError);
        }

        const rem = stat.size % 512;
        if (rem !== 0) {
          await writeToStream(gzip, Buffer.alloc(512 - rem));
        }
      }
    }

    await writeToStream(gzip, Buffer.alloc(1024));
    gzip.end();
    await pipePromise;
  } catch (err) {
    gzip.destroy(err as Error);
    if ("destroy" in writeStream && typeof writeStream.destroy === "function") {
      writeStream.destroy(err as Error);
    }
    await pipePromise.catch(() => {});
    throw err;
  }
}

