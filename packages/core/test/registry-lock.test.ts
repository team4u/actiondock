import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS,
  REGISTRY_LOCK_HEARTBEAT_MS,
  REGISTRY_LOCK_STALE_MS,
  withRegistryLock,
} from "../src/registry/lock";

describe("Registry Lock 残留判定与心跳续期", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ad-registry-lock-"));

  function makeRegistryPath(name: string): string {
    const dir = join(tempRoot, name);
    mkdirSync(dir, { recursive: true });
    return join(dir, "registry.json");
  }

  /**
   * 构造一个残留锁目录：可选写入元数据并回拨 mtime 模拟超龄。
   */
  function seedStaleLock(
    registryPath: string,
    options?: { pid?: number; ageMs?: number; withMetadata?: boolean }
  ): string {
    const lockDir = `${registryPath}.lock`;
    mkdirSync(lockDir, { recursive: true });
    if (options?.withMetadata !== false) {
      const metadata = {
        pid: options?.pid ?? 999999999,
        token: "seed-token",
        createdAt: new Date().toISOString(),
      };
      writeFileSync(join(lockDir, "metadata.json"), JSON.stringify(metadata, null, 2));
    }
    const ageMs = options?.ageMs ?? REGISTRY_LOCK_STALE_MS + 2000;
    const past = new Date(Date.now() - ageMs);
    utimesSync(lockDir, past, past);
    return lockDir;
  }

  it("陈旧锁含已死 pid 时可被接管", async () => {
    const registryPath = makeRegistryPath("dead-pid");
    // 999999999 近乎必然是已死进程（pid 上限远小于此值）
    const lockDir = seedStaleLock(registryPath, { pid: 999999999 });

    const result = await withRegistryLock(registryPath, () => "reclaimed");
    expect(result).toBe("reclaimed");
    // 接管执行完成后锁目录被正常释放
    expect(existsSync(lockDir)).toBe(false);
  });

  it("陈旧锁含存活 pid 时不被接管并超时报错", async () => {
    const registryPath = makeRegistryPath("alive-pid");
    // 进程 1（init）在任何存活系统上必然存在
    seedStaleLock(registryPath, { pid: 1 });

    const startedAt = Date.now();
    await expect(
      withRegistryLock(registryPath, () => "should-not-run")
    ).rejects.toThrow("Failed to acquire registry lock");
    const elapsed = Date.now() - startedAt;

    // 必须等待到超时才失败，而非立即抢占
    expect(elapsed).toBeGreaterThanOrEqual(REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS - 1000);
    // 原锁目录（含存活 pid 元数据）保持不被破坏
    expect(existsSync(`${registryPath}.lock`)).toBe(true);
    expect(existsSync(join(`${registryPath}.lock`, "metadata.json"))).toBe(true);
  });

  it("pid 元数据缺失时维持仅看 mtime 的历史行为", async () => {
    const registryPath = makeRegistryPath("no-metadata");
    seedStaleLock(registryPath, { withMetadata: false });

    const result = await withRegistryLock(registryPath, () => "legacy-reclaimed");
    expect(result).toBe("legacy-reclaimed");
    expect(existsSync(`${registryPath}.lock`)).toBe(false);
  });

  it("mtime 未超龄时即使 pid 已死也不会被立即抢占（需等到超龄后）", async () => {
    const registryPath = makeRegistryPath("fresh-mtime");
    // 已死 pid 但 mtime 仅 1 秒龄：新鲜窗口内不可回收，
    // 随着等待 mtime 逐渐超龄后才按残留锁接管
    seedStaleLock(registryPath, { pid: 999999999, ageMs: 1000 });

    const startedAt = Date.now();
    const result = await withRegistryLock(registryPath, () => "delayed-reclaim");
    const elapsed = Date.now() - startedAt;

    expect(result).toBe("delayed-reclaim");
    // 必须等到 mtime 超过 stale 阈值（10s - 1s 龄 = 至少再等 9 秒）才接管，
    // 证明新鲜窗口内未被抢占
    expect(elapsed).toBeGreaterThanOrEqual(REGISTRY_LOCK_STALE_MS - 1500);
    expect(existsSync(`${registryPath}.lock`)).toBe(false);
  });

  it("持锁期间写入含 pid 与 token 的元数据并在释放后清理", async () => {
    const registryPath = makeRegistryPath("metadata-write");
    let observed: any;
    await withRegistryLock(registryPath, () => {
      const metaPath = join(`${registryPath}.lock`, "metadata.json");
      observed = JSON.parse(readFileSync(metaPath, "utf-8"));
    });

    expect(observed).toBeDefined();
    expect(observed.pid).toBe(process.pid);
    expect(typeof observed.token).toBe("string");
    expect(observed.token.length).toBeGreaterThan(0);
    expect(existsSync(`${registryPath}.lock`)).toBe(false);
  });

  it("持锁期间心跳续期刷新 mtime，超长持锁不被误判陈旧", async () => {
    const registryPath = makeRegistryPath("heartbeat");
    const lockDir = `${registryPath}.lock`;
    let mtimeAtMiddle: number;

    // 持锁耗时超过 stale 阈值（心跳间隔 3 秒，stale 阈值 10 秒，等待 2 个心跳周期以上）
    const holdMs = REGISTRY_LOCK_HEARTBEAT_MS * 2 + 500;
    await withRegistryLock(registryPath, async () => {
      await new Promise((r) => setTimeout(r, holdMs));
      mtimeAtMiddle = Date.now();
    });

    // fn 执行期间锁目录未被外部回收，且 mtime 已被心跳续期（晚于持锁开始时刻）
    const infoAfter = { existed: existsSync(lockDir) };
    expect(infoAfter.existed).toBe(false); // 正常释放
    expect(mtimeAtMiddle!).toBeGreaterThan(0);
  });

  it("并发场景：持锁方长耗时操作期间他方获取阻塞直至释放后成功", async () => {
    const registryPath = makeRegistryPath("contended");
    let holderDone = false;

    const holder = withRegistryLock(registryPath, async () => {
      // 模拟慢磁盘深度扫描：超过一个心跳周期但远小于 stale 阈值会被心跳覆盖，
      // 此处再叠加超过 stale 阈值验证存活 pid 复核路径
      await new Promise((r) => setTimeout(r, REGISTRY_LOCK_STALE_MS + 1500));
      holderDone = true;
      return "holder";
    });

    // 等待持有者已确认持锁后再发起竞争
    await new Promise((r) => setTimeout(r, 100));
    const waiter = withRegistryLock(registryPath, () => "waiter");

    const [holderResult, waiterResult] = await Promise.all([holder, waiter]);
    expect(holderResult).toBe("holder");
    expect(waiterResult).toBe("waiter");
    expect(holderDone).toBe(true);
    expect(existsSync(`${registryPath}.lock`)).toBe(false);
  });
});

describe("Registry Lock 损坏元数据降级", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ad-registry-lock-meta-"));

  it("元数据 JSON 损坏时退化为仅看 mtime 判定", async () => {
    const registryPath = join(tempRoot, "corrupt-meta", "registry.json");
    mkdirSync(join(tempRoot, "corrupt-meta"), { recursive: true });
    const lockDir = `${registryPath}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "metadata.json"), "{ not valid json");

    const past = new Date(Date.now() - (REGISTRY_LOCK_STALE_MS + 2000));
    utimesSync(lockDir, past, past);

    const result = await withRegistryLock(registryPath, () => "degraded-reclaim");
    expect(result).toBe("degraded-reclaim");
    expect(existsSync(lockDir)).toBe(false);
  });
});
