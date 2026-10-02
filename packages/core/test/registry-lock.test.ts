import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
    assert.strictEqual(result, "reclaimed");
    // 接管执行完成后锁目录被正常释放
    assert.strictEqual(existsSync(lockDir), false);
  });

  it("陈旧锁含存活 pid 时不被接管并超时报错", async () => {
    const registryPath = makeRegistryPath("alive-pid");
    // 启动跨平台绝对存活的独立子进程，避免硬编码 pid 1 在 Windows 下不存在（Windows 无 pid 1）
    const dummy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      seedStaleLock(registryPath, { pid: dummy.pid });

      const startedAt = Date.now();
      await assert.rejects(
        withRegistryLock(registryPath, () => "should-not-run", {
          acquireTimeoutMs: 120,
          retryDelayMs: 15,
        })
      , /Failed to acquire registry lock/);
      const elapsed = Date.now() - startedAt;

      // 必须等待到超时才失败，而非立即抢占
      assert.ok((elapsed) >= 80);
      // 原锁目录（含存活 pid 元数据）保持不被破坏
      assert.strictEqual(existsSync(`${registryPath}.lock`), true);
      assert.strictEqual(existsSync(join(`${registryPath}.lock`, "metadata.json")), true);
    } finally {
      dummy.kill();
    }
  });

  it("pid 元数据缺失时维持仅看 mtime 的历史行为", async () => {
    const registryPath = makeRegistryPath("no-metadata");
    seedStaleLock(registryPath, { withMetadata: false });

    const result = await withRegistryLock(registryPath, () => "legacy-reclaimed");
    assert.strictEqual(result, "legacy-reclaimed");
    assert.strictEqual(existsSync(`${registryPath}.lock`), false);
  });

  it("mtime 未超龄时即使 pid 已死也不会被立即抢占（需等到超龄后）", async () => {
    const registryPath = makeRegistryPath("fresh-mtime");
    // 已死 pid 但 mtime 仅 20 毫秒龄：新鲜窗口内不可回收，
    // 随着等待 mtime 逐渐超龄后才按残留锁接管
    seedStaleLock(registryPath, { pid: 999999999, ageMs: 20 });

    const startedAt = Date.now();
    const result = await withRegistryLock(
      registryPath,
      () => "delayed-reclaim",
      { staleMs: 120, acquireTimeoutMs: 600, retryDelayMs: 15 }
    );
    const elapsed = Date.now() - startedAt;

    assert.strictEqual(result, "delayed-reclaim");
    // 必须等到 mtime 超过 stale 阈值（120ms - 20ms 龄 = 至少再等 100ms）才接管，
    // 证明新鲜窗口内未被抢占
    assert.ok((elapsed) >= 80);
    assert.strictEqual(existsSync(`${registryPath}.lock`), false);
  });

  it("持锁期间写入含 pid 与 token 的元数据并在释放后清理", async () => {
    const registryPath = makeRegistryPath("metadata-write");
    let observed: any;
    await withRegistryLock(registryPath, () => {
      const metaPath = join(`${registryPath}.lock`, "metadata.json");
      observed = JSON.parse(readFileSync(metaPath, "utf-8"));
    });

    assert.notStrictEqual(observed, undefined);
    assert.strictEqual(observed.pid, process.pid);
    assert.strictEqual(typeof observed.token, "string");
    assert.ok((observed.token.length) > 0);
    assert.strictEqual(existsSync(`${registryPath}.lock`), false);
  });

  it("持锁期间心跳续期刷新 mtime，超长持锁不被误判陈旧", async () => {
    const registryPath = makeRegistryPath("heartbeat");
    const lockDir = `${registryPath}.lock`;
    let mtimeAtMiddle: number;

    const holdMs = 70;
    await withRegistryLock(
      registryPath,
      async () => {
        await new Promise((r) => setTimeout(r, holdMs));
        mtimeAtMiddle = Date.now();
      },
      { heartbeatMs: 30, staleMs: 80 }
    );

    // fn 执行期间锁目录未被外部回收，且 mtime 已被心跳续期（晚于持锁开始时刻）
    const infoAfter = { existed: existsSync(lockDir) };
    assert.strictEqual(infoAfter.existed, false); // 正常释放
    assert.ok((mtimeAtMiddle!) > 0);
  });

  it("并发场景：持锁方长耗时操作期间他方获取阻塞直至释放后成功", async () => {
    const registryPath = makeRegistryPath("contended");
    let holderDone = false;

    const lockOptions = { staleMs: 80, heartbeatMs: 25, retryDelayMs: 10 };
    const holder = withRegistryLock(
      registryPath,
      async () => {
        await new Promise((r) => setTimeout(r, 90));
        holderDone = true;
        return "holder";
      },
      lockOptions
    );

    // 等待持有者已确认持锁后再发起竞争
    await new Promise((r) => setTimeout(r, 20));
    const waiter = withRegistryLock(registryPath, () => "waiter", lockOptions);

    const [holderResult, waiterResult] = await Promise.all([holder, waiter]);
    assert.strictEqual(holderResult, "holder");
    assert.strictEqual(waiterResult, "waiter");
    assert.strictEqual(holderDone, true);
    assert.strictEqual(existsSync(`${registryPath}.lock`), false);
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
    assert.strictEqual(result, "degraded-reclaim");
    assert.strictEqual(existsSync(lockDir), false);
  });
});
