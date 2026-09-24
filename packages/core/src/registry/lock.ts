import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isProcessAlive } from "../utils/process";

/**
 * 锁目录最近一次心跳（创建或续期）后超过该时长且持有进程已死亡，
 * 才视为持有进程异常退出的残留锁。
 */
export const REGISTRY_LOCK_STALE_MS = 10000;

/**
 * 获取锁的最长等待时间，必须大于 REGISTRY_LOCK_STALE_MS，
 * 保证等待方至少有机会观察到残留锁被回收后再判定超时。
 */
export const REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS = 15000;

/**
 * 两次获取尝试之间的退避间隔，休眠让出事件循环，避免忙等阻塞。
 */
export const REGISTRY_LOCK_RETRY_DELAY_MS = 25;

/**
 * 持锁期间的心跳续期间隔。持有者定期 touch 锁目录刷新 mtime，
 * 使长耗时持锁操作（如 linkPackage 的深度扫描）不会仅因耗时超过
 * stale 阈值而被等待方误判为残留锁抢占。
 */
export const REGISTRY_LOCK_HEARTBEAT_MS = 3000;

/**
 * 锁配置选项。
 */
export interface RegistryLockOptions {
  staleMs?: number;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
  heartbeatMs?: number;
}

/**
 * 锁目录内的持有者元数据文件名。
 */
const LOCK_METADATA_FILE = "metadata.json";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 锁持有者元数据契约。
 */
interface RegistryLockMetadata {
  /** 持有进程标识符 */
  pid: number;
  /** 本次持锁会话的随机令牌（用于诊断与未来的所有权复核） */
  token: string;
  /** 创建时间戳（ISO 8601 格式） */
  createdAt: string;
}

/**
 * 读取锁目录中的持有者元数据；缺失、不可读或结构非法时返回 undefined。
 * 元数据信息缺失时陈旧判定退化为仅看 mtime 年龄（与历史行为兼容）。
 */
async function readLockMetadata(lockDir: string): Promise<RegistryLockMetadata | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(lockDir, LOCK_METADATA_FILE), "utf-8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.pid === "number" &&
      typeof parsed.token === "string"
    ) {
      return {
        pid: parsed.pid,
        token: parsed.token,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
      };
    }
  } catch {
    // 损坏的元数据视同缺失
  }
  return undefined;
}

/**
 * 本进程当前持有的注册表锁目录集合。
 * 用于区分「同进程在途持锁」（不可回收，需等待）与「同进程历史泄漏锁」
 * （释放阶段 rm 失败遗留，pid 存活复核下仍应可回收），
 * 避免存活 pid 保守判定把自身泄漏锁变成永久死锁。
 */
const activeLockDirs = new Set<string>();

/**
 * 判定锁目录是否为可回收的残留锁。
 *
 * 判定语义（保守优先，保护并发正确性）：
 * - mtime 未超龄：一律不回收（正常持锁或心跳间隔内的活跃锁）。
 * - mtime 超龄 且元数据含存活 pid：不回收（慢磁盘下长扫描的持锁者仍活着；
 *   同进程在途持锁同样不回收，交由释放后重试获取）。
 * - mtime 超龄 且元数据 pid 已死：回收。
 * - mtime 超龄 且元数据缺失/非法：仅看 mtime 维持历史行为回收
 *   （兼容旧版本无元数据锁目录与竞态窗口内的半初始化锁目录）。
 */
async function isStaleLock(lockDir: string, staleMs: number = REGISTRY_LOCK_STALE_MS): Promise<boolean> {
  let lockAgeMs: number;
  try {
    const info = await stat(lockDir);
    lockAgeMs = Date.now() - info.mtimeMs;
  } catch (err: any) {
    // ENOENT：持有者恰好在两次探测之间释放，交由调用方立即重试获取
    throw err;
  }

  if (lockAgeMs <= staleMs) {
    return false;
  }

  const metadata = await readLockMetadata(lockDir);
  if (metadata === undefined) {
    return true;
  }

  if (metadata.pid === process.pid) {
    // 同进程：仅在途持锁不可回收，历史泄漏锁（不在活跃集合）可回收
    return !activeLockDirs.has(lockDir);
  }

  return !isProcessAlive(metadata.pid);
}

/**
 * 异步注册表锁（防止多进程并发读写导致 registry.json 损坏）。
 *
 * 获取方式：fs/promises mkdir 的原子性保证同一时刻仅一个进程能创建锁目录，
 * 创建成功后立即写入含 pid 与随机 token 的 metadata.json。
 * 冲突处理：EEXIST 时按保守语义判定残留（见 isStaleLock）：mtime 超龄且
 * pid 已死才抢占——抢占仍通过原子 rename 到隔离名实现，rename 仅有一个
 * 进程能成功，失败方回到等待重试，消除「检查后删除再重建」的竞态窗口；
 * 未过期的锁通过 sleep 让出事件循环后重试。
 * 心跳续期：持锁期间以固定间隔 touch 锁目录刷新 mtime，使 linkPackage 等
 * 长耗时持锁操作不会仅因耗时被误判残留；fn 完成后停止心跳并删除锁目录。
 *
 * @param filePath 注册表文件路径，锁目录为其同级 `${filePath}.lock`
 * @param fn 持锁期间执行的操作（同步或异步）
 * @param options 可选锁超时与重试配置
 * @returns fn 的返回值
 * @throws 超过 acquireTimeoutMs 仍未获取时抛出描述性错误
 */
export async function withRegistryLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
  options?: RegistryLockOptions
): Promise<T> {
  const staleMs = options?.staleMs ?? REGISTRY_LOCK_STALE_MS;
  const acquireTimeoutMs = options?.acquireTimeoutMs ?? REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS;
  const retryDelayMs = options?.retryDelayMs ?? REGISTRY_LOCK_RETRY_DELAY_MS;
  const heartbeatMs = options?.heartbeatMs ?? REGISTRY_LOCK_HEARTBEAT_MS;

  const lockDir = `${filePath}.lock`;
  const deadline = Date.now() + acquireTimeoutMs;

  while (true) {
    try {
      // 原子获取：目录创建成功即持有锁，无需二次确认
      await mkdir(lockDir);
      activeLockDirs.add(lockDir);
      break;
    } catch (err: any) {
      if (err.code !== "EEXIST") {
        throw err;
      }
    }

    // 锁被占用，检查是否为可回收的残留锁
    let stale: boolean;
    try {
      stale = await isStaleLock(lockDir, staleMs);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        // 持有者恰好在两次探测之间释放，立即重试获取
        continue;
      }
      throw err;
    }

    if (stale) {
      // 原子抢占：rename 到含进程号与时间戳的隔离名，仅一个进程能成功；
      // 失败方说明已被其他等待者抢先处理，回到等待重试即可
      const quarantine = `${lockDir}.stale.${process.pid}.${Date.now()}`;
      try {
        await rename(lockDir, quarantine);
        await rm(quarantine, { recursive: true, force: true });
        continue;
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // 其他等待者已抢先回收该残留锁
          continue;
        }
        // 其他原因的 rename 失败（如瞬时权限问题）不视为致命，退回等待重试
      }
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Failed to acquire registry lock '${lockDir}' within ${acquireTimeoutMs}ms. ` +
          `The lock may be held by another ActionDock process; retry after it exits or remove the stale lock directory manually.`
      );
    }

    await sleep(retryDelayMs);
  }

  // 持有者元数据写入失败不阻断持锁（退化为仅 mtime 判定），但保证可观测
  try {
    const metadata: RegistryLockMetadata = {
      pid: process.pid,
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(lockDir, LOCK_METADATA_FILE), JSON.stringify(metadata, null, 2), "utf-8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[Registry] Failed to write lock metadata in '${lockDir}': ${reason}`);
  }

  // 心跳续期：定期 touch 锁目录刷新 mtime，防止长耗时持锁操作被误判残留。
  // 单次 touch 失败仅告警不中断（mtime 未刷新仅会提前暴露为陈旧候选，
  // 由 pid 存活复核兜底，不会破坏互斥）。
  const heartbeat = setInterval(() => {
    const now = new Date();
    utimes(lockDir, now, now).catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[Registry] Failed to refresh lock heartbeat for '${lockDir}': ${reason}`);
    });
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    activeLockDirs.delete(lockDir);
    try {
      await rm(lockDir, { recursive: true, force: true });
    } catch {
      // 释放失败可忽略：进程未清理的锁目录会随时间超过 stale 阈值，
      // 被后续获取方的原子 rename 抢占回收，不会造成永久死锁
    }
  }
}
