import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { ActionDockError, CONFIG_ENCRYPTION_ERROR } from "../errors";
import { getActionDockHome } from "../utils";
import { configKeyId, type ConfigEncryptionKey, type ConfigKeyProvider } from "./config-cipher";

/** 环境变量密钥来源名称，值必须为严格的 64 位十六进制字符串 */
const ENV_KEY_NAME = "ACTIONDOCK_ENCRYPTION_KEY";

/**
 * 环境密钥的严格格式：恰好 64 位十六进制字符（解码后恰为 32 字节 AES-256 密钥）。
 * 空字符串、空白或前后填充均视为非法取值，绝不允许回退到本地密钥来源。
 */
const ENV_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/** AES-256 密钥字节长度 */
const KEY_BYTES = 32;

/** 密钥文件与身份标记规范权限：仅属主可读写 */
const KEY_FILE_MODE = 0o600;

/** 密钥目录规范权限：仅属主可访问 */
const KEY_DIR_MODE = 0o700;

/** 密钥指纹的规范形式：64 位小写十六进制字符 */
const KEY_ID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * POSIX 权限位语义在 Windows 上不存在，权限强制校验仅在 POSIX 平台执行；
 * 常规文件与真实目录（拒绝符号链接）检查在所有平台始终生效。
 */
const IS_POSIX = process.platform !== "win32";

/**
 * 平台明确不支持目录 fsync 的错误码集合，仅这些可安全忽略；
 * EIO 等真实 I/O 故障必须作为失败透传，不得静默吞没。
 */
const DIRECTORY_FSYNC_UNSUPPORTED_CODES = new Set([
  "EINVAL",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

/** Windows 可能拒绝打开目录句柄；POSIX 上同类权限错误必须透传。 */
const WINDOWS_DIRECTORY_FSYNC_UNSUPPORTED_CODES = new Set(["EPERM", "EACCES", "EISDIR"]);

/**
 * 配置加密密钥提供器构造选项。
 */
export interface ConfigKeyProviderOptions {
  /** 覆盖用户主目录定位（与 getActionDockHome 的 customHome 语义一致） */
  customHome?: string;
  /** 数据目录定位：密钥落盘为 <dataDir>/keys/config.key，优先于主目录定位 */
  dataDir?: string;
  /** 显式注入密钥材料：纯内存使用，不读取环境变量，也不访问或创建任何真实目录 */
  key?: Uint8Array;
  /** 环境变量快照来源（缺省读取 process.env），至少须支持 ACTIONDOCK_ENCRYPTION_KEY */
  env?: Record<string, string | undefined>;
}

/** 密钥存储路径集合 */
interface ConfigKeyPaths {
  /** 密钥目录 */
  keyDir: string;
  /** 本地密钥文件路径（32 字节原始密钥） */
  keyPath: string;
  /** 密钥身份标记路径（记录指纹，防止密钥丢失后静默再生） */
  markerPath: string;
}

/** 已加载的密钥材料及其持久化身份状态 */
interface LoadedMaterial {
  /** 密钥材料 */
  material: ConfigEncryptionKey;
  /** 存储域身份是否已在磁盘钉住（标记已创建或已校验）；注入来源恒为 true */
  pinned: boolean;
  /** 材料来源，决定后续钉住身份时的校验范围 */
  source: "injected" | "env" | "file";
}

/**
 * 创建配置加密密钥提供器。
 *
 * 来源优先级：
 * - 显式注入 key：纯内存材料，绝不读取环境变量或真实用户目录，也无需钉住持久身份；
 * - 环境变量 ACTIONDOCK_ENCRYPTION_KEY：必须为恰好 64 位十六进制字符，
 *   只要被设置（含空串或空白）就必须严格合法，非法取值立即报错，
 *   绝不静默回退到本地密钥；
 * - 本地密钥文件：dataDir 有值时为 <dataDir>/keys/config.key，
 *   否则为 getActionDockHome(customHome)/.actiondock/keys/config.key。
 *
 * 构造时不发生任何环境读取、文件访问或目录创建；全部定位与加载在
 * 首次调用时完成并缓存，此后同一提供器实例不再感知环境变化（宿主快照）。
 * 若首次调用以 create 为 false 加载了未钉住身份的材料，后续 create 为 true
 * 的调用会先原子创建或校验身份标记再返回缓存材料，保证允许写入前
 * 持久域身份一定已经落盘。
 *
 * 身份保护：标记存在而密钥材料丢失时直接报错，绝不为同一存储域重新
 * 生成新密钥；提供密钥与标记指纹不符时同样拒绝。
 */
export function createConfigKeyProvider(options?: ConfigKeyProviderOptions): ConfigKeyProvider {
  const opts = options ?? {};
  let cached: LoadedMaterial | undefined;

  return (create: boolean): ConfigEncryptionKey => {
    if (cached === undefined) {
      cached =
        opts.key !== undefined
          ? { material: materialFromInjectedKey(opts.key), pinned: true, source: "injected" }
          : loadMaterialFromEnvironmentOrFile(opts, create);
      return cached.material;
    }
    if (create && !cached.pinned) {
      pinPersistedIdentity(opts, cached);
      cached = { ...cached, pinned: true };
    }
    return cached.material;
  };
}

/**
 * 为缓存的未钉住材料补齐持久域身份：原子创建或校验身份标记。
 *
 * 首次以只读方式（create 为 false）加载的材料可能尚未在磁盘钉住身份；
 * 在任何允许写入的调用返回前必须补齐，防止宿主进程在从未落盘身份的
 * 状态下写出密文后丢失密钥归属。注入来源纯内存，直接跳过。
 */
function pinPersistedIdentity(opts: ConfigKeyProviderOptions, state: LoadedMaterial): void {
  if (state.source === "injected") {
    return;
  }
  const paths = resolveKeyPaths(opts);
  const id = state.material.id;

  if (state.source === "env" && existsSync(paths.keyPath)) {
    assertSecureKeyDirectory(paths.keyDir);
    const fileBytes = readKeyFile(paths.keyPath);
    if (configKeyId(fileBytes) !== id) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Environment key identity does not match the existing local key file '${paths.keyPath}'`
      );
    }
  }

  const markerId = readMarkerIdIfExists(paths.markerPath);
  if (markerId !== undefined) {
    assertSecureKeyDirectory(paths.keyDir);
    if (markerId !== id) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Recorded key identity marker '${paths.markerPath}' does not match the active key; refusing to continue with a different key`
      );
    }
    return;
  }
  assertOrCreateSecureKeyDirectory(paths.keyDir);
  publishMarkerFile(paths.markerPath, id);
}

/**
 * 解析密钥存储路径集合。
 */
function resolveKeyPaths(opts: ConfigKeyProviderOptions): ConfigKeyPaths {
  const keyDir =
    opts.dataDir && opts.dataDir.length > 0
      ? join(opts.dataDir, "keys")
      : join(getActionDockHome(opts.customHome), ".actiondock", "keys");
  return {
    keyDir,
    keyPath: join(keyDir, "config.key"),
    markerPath: join(keyDir, "config.key.id"),
  };
}

/**
 * 构造显式注入密钥的材料。
 *
 * 纯内存路径：仅校验密钥长度并计算指纹，不读取环境变量，
 * 不访问、校验或创建任何真实文件系统路径，也不持久化身份标记。
 */
function materialFromInjectedKey(key: Uint8Array): ConfigEncryptionKey {
  if (!(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Invalid injected config encryption key: expected ${KEY_BYTES} bytes, got ${
        key instanceof Uint8Array ? key.byteLength : typeof key
      }`
    );
  }
  return { key, id: configKeyId(key) };
}

/**
 * 依据来源优先级加载持久化密钥材料：环境变量优先于本地密钥文件。
 *
 * 环境变量一旦被设置（包括空串、空白或任何非法形态）就必须严格合法，
 * 不存在“视为未设置”的宽松路径，杜绝无效配置静默回退。
 */
function loadMaterialFromEnvironmentOrFile(
  opts: ConfigKeyProviderOptions,
  create: boolean
): LoadedMaterial {
  const paths = resolveKeyPaths(opts);
  const envSource = opts.env ?? process.env;
  const raw = envSource[ENV_KEY_NAME];
  if (raw !== undefined) {
    return loadEnvKeyMaterial(raw, paths, create);
  }
  return loadLocalKeyMaterial(paths, create);
}

/**
 * 解析环境变量密钥来源。
 *
 * 值必须为恰好 64 位十六进制字符（仅允许大小写差异），空串、空白、
 * 前后填充或任何非法字符均立即抛出 CONFIG_ENCRYPTION_ERROR，绝不回退
 * 到本地密钥文件。首次允许创建时同样原子记录身份标记；若本地密钥文件
 * 或标记已存在且指纹不同，则拒绝使用该环境密钥，防止用第二把有效密钥
 * 写入历史密钥的存储域。标记存在时密钥目录必须通过安全校验，不因
 * 缺少本地密钥文件而绕过目录检查。
 */
function loadEnvKeyMaterial(raw: string, paths: ConfigKeyPaths, create: boolean): LoadedMaterial {
  if (typeof raw !== "string" || !ENV_KEY_PATTERN.test(raw)) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Environment variable ${ENV_KEY_NAME} must be exactly 64 hex characters (32 bytes); the configured value is invalid and falling back to another key source is not permitted`
    );
  }
  const keyBytes = Buffer.from(raw, "hex");
  const id = configKeyId(keyBytes);

  if (existsSync(paths.keyPath)) {
    assertSecureKeyDirectory(paths.keyDir);
    const fileBytes = readKeyFile(paths.keyPath);
    if (configKeyId(fileBytes) !== id) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Environment key identity does not match the existing local key file '${paths.keyPath}'`
      );
    }
  }

  const markerId = readMarkerIdIfExists(paths.markerPath);
  if (markerId !== undefined) {
    assertSecureKeyDirectory(paths.keyDir);
    if (markerId !== id) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Environment key identity does not match the recorded key identity marker '${paths.markerPath}'`
      );
    }
    return { material: { key: keyBytes, id }, pinned: true, source: "env" };
  }
  if (create) {
    assertOrCreateSecureKeyDirectory(paths.keyDir);
    publishMarkerFile(paths.markerPath, id);
    return { material: { key: keyBytes, id }, pinned: true, source: "env" };
  }
  return { material: { key: keyBytes, id }, pinned: false, source: "env" };
}

/**
 * 加载本地密钥文件材料，必要时按安全约束生成并发布新密钥。
 */
function loadLocalKeyMaterial(paths: ConfigKeyPaths, create: boolean): LoadedMaterial {
  const markerId = readMarkerIdIfExists(paths.markerPath);

  if (!existsSync(paths.keyPath)) {
    if (markerId !== undefined) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Config encryption key file '${paths.keyPath}' is missing while identity marker '${paths.markerPath}' still pins key id '${markerId}'; refusing to generate a new key for this storage domain. Restore the original key file or provide ${ENV_KEY_NAME}`,
        { keyPath: paths.keyPath, markerPath: paths.markerPath }
      );
    }
    if (!create) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Config encryption key file '${paths.keyPath}' does not exist and key creation is disabled for this call`,
        { keyPath: paths.keyPath }
      );
    }
    publishGeneratedKeyFile(paths.keyDir, paths.keyPath);
  }

  assertSecureKeyDirectory(paths.keyDir);
  const keyBytes = readKeyFile(paths.keyPath);
  const id = configKeyId(keyBytes);

  if (markerId !== undefined) {
    if (markerId !== id) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Config encryption key file '${paths.keyPath}' does not match the recorded key identity marker '${paths.markerPath}'`,
        { keyPath: paths.keyPath, markerPath: paths.markerPath }
      );
    }
    return { material: { key: keyBytes, id }, pinned: true, source: "file" };
  }
  if (create) {
    publishMarkerFile(paths.markerPath, id);
    return { material: { key: keyBytes, id }, pinned: true, source: "file" };
  }
  return { material: { key: keyBytes, id }, pinned: false, source: "file" };
}

/**
 * 生成随机密钥并安全发布到目标路径。
 *
 * 发布语义：先在私有临时文件中完整写入 32 字节随机密钥并 fsync，
 * 再以不覆盖的硬链接原子发布；竞争失败方直接读取胜者已发布的完整文件，
 * 绝不出现先用独占标志创建目标再缓慢写入导致他人读到半文件的窗口。
 */
function publishGeneratedKeyFile(keyDir: string, keyPath: string): void {
  assertOrCreateSecureKeyDirectory(keyDir);
  const material = randomBytes(KEY_BYTES);
  publishAtomically(keyPath, material, KEY_FILE_MODE);
}

/**
 * 原子发布身份标记文件，竞争发布失败时复核既有标记一致性。
 *
 * 发布成功路径内含所属目录的尽力 fsync，确保标记目录项先于密文持久化。
 */
function publishMarkerFile(markerPath: string, id: string): void {
  const published = publishAtomically(markerPath, Buffer.from(`${id}\n`, "utf8"), KEY_FILE_MODE);
  if (!published) {
    const existing = readMarkerIdIfExists(markerPath);
    if (existing !== id) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Recorded key identity marker '${markerPath}' does not match the active key; refusing to overwrite`
      );
    }
  }
}

/**
 * 以不覆盖方式原子发布文件内容。
 *
 * 发布分三段且各段失败均清理临时文件：完整写入并 fsync 私有临时文件、
 * 修正权限位、以硬链接原子发布到目标路径。目标已存在（EEXIST）时返回
 * false 表示竞争失败，由调用方读取胜者已发布的完整文件。
 *
 * 临时文件承载主密钥内容：任何失败路径都必须尽力删除临时文件；发布成功
 * 后临时文件名与目标共享同一 inode，也必须移除临时名，避免密钥材料多出
 * 一条可达路径。清理失败与真实 I/O 故障一律包装为 CONFIG_ENCRYPTION_ERROR
 * 透传，不得静默吞没。
 */
function publishAtomically(targetPath: string, content: Buffer, mode: number): boolean {
  const dir = dirname(targetPath);
  const tmpPath = join(dir, `.${basename(targetPath)}.tmp.${process.pid}.${randomUUID()}`);

  try {
    const fd = openSync(tmpPath, "wx", mode);
    try {
      writeAll(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (IS_POSIX) {
      chmodSync(tmpPath, mode);
    }
  } catch (err) {
    if (!cleanupTempFile(tmpPath)) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Failed to write key-bearing temporary file '${tmpPath}' and its cleanup also failed; remove the file manually before retrying`,
        { path: tmpPath }
      );
    }
    throw wrapFsError(err, tmpPath);
  }

  try {
    linkSync(tmpPath, targetPath);
  } catch (err: any) {
    if (!cleanupTempFile(tmpPath)) {
      throw new ActionDockError(
        CONFIG_ENCRYPTION_ERROR,
        `Failed to publish '${targetPath}' and cleaning up key-bearing temporary file '${tmpPath}' also failed; remove the file manually before retrying`,
        { path: tmpPath }
      );
    }
    if (err instanceof Error && (err as any).code === "EEXIST") {
      return false;
    }
    throw wrapFsError(err, targetPath);
  }

  if (!cleanupTempFile(tmpPath)) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Published '${targetPath}' but removing its temporary name '${tmpPath}' failed; both names currently expose the same key material`,
      { path: tmpPath }
    );
  }
  fsyncDirectory(dir);
  return true;
}

/**
 * 删除承载密钥材料的临时文件；返回是否清理成功。
 *
 * 文件不存在视为已清理；其余失败向上交由调用方以统一错误透传，
 * 因为残留的临时文件本身就是主密钥的一条可达路径。
 */
function cleanupTempFile(tmpPath: string): boolean {
  try {
    unlinkSync(tmpPath);
    return true;
  } catch (err: any) {
    if (err instanceof Error && (err as any).code === "ENOENT") {
      return true;
    }
    return false;
  }
}

/**
 * 循环写入直至全部字节落盘。
 */
function writeAll(fd: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.byteLength) {
    offset += writeSync(fd, content, offset, content.byteLength - offset);
  }
}

/**
 * 同步目录项以确保发布链接在断电后仍然存在。
 *
 * 崩溃耐久性：仅 fsync 临时文件不足以保证断电后文件名存在，发布链接后
 * 必须 fsync 所属目录，使目录项先于任何依赖该密钥的密文持久化；提供器
 * 在目录同步完成后才返回材料，保证调用方后续写入的密文不会引用一个
 * 掉电后丢失的密钥名。仅平台明确不支持目录 fsync 的错误码可忽略，
 * EIO 等真实故障必须失败。
 */
function fsyncDirectory(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (err: any) {
    const code = err instanceof Error && typeof (err as any).code === "string" ? (err as any).code : undefined;
    if (code !== undefined && (
      DIRECTORY_FSYNC_UNSUPPORTED_CODES.has(code) ||
      (!IS_POSIX && WINDOWS_DIRECTORY_FSYNC_UNSUPPORTED_CODES.has(code))
    )) {
      return;
    }
    throw wrapFsError(err, dir);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // fsync 已完成，描述符关闭失败不影响目录项持久化语义
      }
    }
  }
}

/**
 * 读取并严格校验本地密钥文件。
 *
 * 所有平台拒绝符号链接与任何非常规文件、非 32 字节长度；
 * POSIX 平台额外强制权限位恰为 0600，安全权限异常不得被忽略。
 */
function readKeyFile(keyPath: string): Buffer {
  let stat;
  try {
    stat = lstatSync(keyPath);
  } catch (err) {
    throw wrapFsError(err, keyPath);
  }
  if (!stat.isFile()) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config encryption key file '${keyPath}' is not a regular file (symlinks and special files are rejected)`
    );
  }
  if (IS_POSIX && (stat.mode & 0o777) !== KEY_FILE_MODE) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config encryption key file '${keyPath}' has unsafe permissions ${(
        stat.mode & 0o777
      ).toString(8)} (expected ${KEY_FILE_MODE.toString(8)})`
    );
  }
  let content: Buffer;
  try {
    content = readFileSync(keyPath);
  } catch (err) {
    throw wrapFsError(err, keyPath);
  }
  if (content.byteLength !== KEY_BYTES) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config encryption key file '${keyPath}' must contain exactly ${KEY_BYTES} bytes, got ${content.byteLength}`
    );
  }
  return content;
}

/**
 * 读取身份标记文件中的指纹；不存在时返回 undefined，存在但损坏即报错。
 *
 * 所有平台拒绝非常规文件；POSIX 平台额外强制权限位恰为 0600，
 * 标记与密钥文件同级安全，不得因非敏感而放宽。
 */
function readMarkerIdIfExists(markerPath: string): string | undefined {
  let stat;
  try {
    stat = lstatSync(markerPath);
  } catch (err: any) {
    if (err instanceof Error && (err as any).code === "ENOENT") {
      return undefined;
    }
    throw wrapFsError(err, markerPath);
  }
  if (!stat.isFile()) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config key identity marker '${markerPath}' is not a regular file`
    );
  }
  if (IS_POSIX && (stat.mode & 0o777) !== KEY_FILE_MODE) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config key identity marker '${markerPath}' has unsafe permissions ${(
        stat.mode & 0o777
      ).toString(8)} (expected ${KEY_FILE_MODE.toString(8)})`
    );
  }
  let content: string;
  try {
    content = readFileSync(markerPath, "utf8");
  } catch (err) {
    throw wrapFsError(err, markerPath);
  }
  const id = content.trim();
  if (!KEY_ID_PATTERN.test(id)) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config key identity marker '${markerPath}' is corrupted (expected 64 lowercase hex characters)`
    );
  }
  return id;
}

/**
 * 校验密钥目录为真实目录（拒绝符号链接）；POSIX 平台额外强制权限恰为 0700。
 */
function assertSecureKeyDirectory(keyDir: string): void {
  let stat;
  try {
    stat = lstatSync(keyDir);
  } catch (err) {
    throw wrapFsError(err, keyDir);
  }
  if (!stat.isDirectory()) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config encryption key directory '${keyDir}' is not a real directory (symlinks are rejected)`
    );
  }
  if (IS_POSIX && (stat.mode & 0o777) !== KEY_DIR_MODE) {
    throw new ActionDockError(
      CONFIG_ENCRYPTION_ERROR,
      `Config encryption key directory '${keyDir}' has unsafe permissions ${(
        stat.mode & 0o777
      ).toString(8)} (expected ${KEY_DIR_MODE.toString(8)})`
    );
  }
}

/**
 * 确保密钥目录存在且安全：缺失时以 0700 递归创建并显式修正权限。
 */
function assertOrCreateSecureKeyDirectory(keyDir: string): void {
  if (existsSync(keyDir)) {
    assertSecureKeyDirectory(keyDir);
    return;
  }
  try {
    mkdirSync(keyDir, { recursive: true, mode: KEY_DIR_MODE });
  } catch (err) {
    throw wrapFsError(err, keyDir);
  }
  if (IS_POSIX) {
    try {
      chmodSync(keyDir, KEY_DIR_MODE);
    } catch (err) {
      throw wrapFsError(err, keyDir);
    }
  }
  assertSecureKeyDirectory(keyDir);
}

/**
 * 将文件系统异常包装为统一的结构化加密配置错误，消息不携带任何秘密。
 */
function wrapFsError(err: unknown, path: string): ActionDockError {
  const reason =
    err instanceof Error && typeof (err as any).code === "string" ? (err as any).code : undefined;
  return new ActionDockError(
    CONFIG_ENCRYPTION_ERROR,
    `Config encryption key storage operation failed on '${path}'${reason ? ` (${reason})` : ""}`,
    { path }
  );
}
