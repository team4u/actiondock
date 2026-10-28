import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createConfigKeyProvider } from "../src/security/config-key";
import { configKeyId } from "../src/security/config-cipher";
import { CONFIG_ENCRYPTION_ERROR } from "../src/errors";

const ENV_KEY_NAME = "ACTIONDOCK_ENCRYPTION_KEY";

function expectCode(fn: () => unknown, code: string): { code: string; message: string; details?: any } {
  try {
    fn();
  } catch (err: any) {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return err;
  }
  assert.fail(`expected error with code ${code} to be thrown`);
}

async function withTempDir(run: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "ad-config-key-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function keyPaths(dataDir: string): { keyDir: string; keyPath: string; markerPath: string } {
  const keyDir = join(dataDir, "keys");
  return { keyDir, keyPath: join(keyDir, "config.key"), markerPath: join(keyDir, "config.key.id") };
}

function hexKey(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** 文件来源提供器统一注入空环境快照，隔离执行环境中可能存在的真实密钥变量 */
function fileProvider(options: { dataDir?: string; customHome?: string }) {
  return createConfigKeyProvider({ ...options, env: {} });
}

describe("createConfigKeyProvider 显式注入密钥", () => {
  it("纯内存使用：不读取环境、不访问或创建任何真实目录", async () => {
    await withTempDir(async (dir) => {
      const injected = randomBytes(32);
      const env: Record<string, string | undefined> = { [ENV_KEY_NAME]: "not-hex-invalid" };
      const provider = createConfigKeyProvider({ dataDir: dir, key: injected, env });
      const material = provider(true);
      assert.equal(material.id, configKeyId(injected));
      const second = provider(false);
      assert.equal(second.id, material.id);
      assert.equal(existsSync(join(dir, "keys")), false);
      assert.equal(readdirSync(dir).length, 0);
    });
  });

  it("注入密钥长度非法时立即报错", async () => {
    await withTempDir(async (dir) => {
      expectCode(() => createConfigKeyProvider({ dataDir: dir, key: randomBytes(31), env: {} })(true), CONFIG_ENCRYPTION_ERROR);
      expectCode(() => createConfigKeyProvider({ dataDir: dir, key: randomBytes(33), env: {} })(false), CONFIG_ENCRYPTION_ERROR);
      assert.equal(existsSync(join(dir, "keys")), false);
    });
  });
});

describe("createConfigKeyProvider 环境变量密钥", () => {
  it("接受恰好 64 位十六进制并计算指纹", async () => {
    await withTempDir(async (dir) => {
      const bytes = randomBytes(32);
      const env = { [ENV_KEY_NAME]: hexKey(bytes) };
      const material = createConfigKeyProvider({ dataDir: dir, env })(true);
      assert.equal(material.id, configKeyId(bytes));
      assert.deepEqual(Buffer.from(material.key), Buffer.from(bytes));
    });
  });

  it("大写十六进制与同一密钥的小写形式归一", async () => {
    await withTempDir(async (dir) => {
      const bytes = randomBytes(32);
      const lower = createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: hexKey(bytes) } })(true);
      const upper = createConfigKeyProvider({
        dataDir: dir,
        env: { [ENV_KEY_NAME]: hexKey(bytes).toUpperCase() },
      })(false);
      assert.equal(upper.id, lower.id);
    });
  });

  it("首次使用记录身份标记且不生成本地密钥文件", async () => {
    await withTempDir(async (dir) => {
      const { keyDir, keyPath, markerPath } = keyPaths(dir);
      const bytes = randomBytes(32);
      const material = createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: hexKey(bytes) } })(true);
      assert.equal(existsSync(keyPath), false);
      assert.equal(readFileSync(markerPath, "utf8").trim(), material.id);
      assert.equal(lstatSync(keyDir).mode & 0o777, 0o700);
      assert.equal(lstatSync(markerPath).mode & 0o777, 0o600);
    });
  });

  const invalidValues = [
    ["63 位", "0".repeat(63)],
    ["65 位", "0".repeat(65)],
    ["非十六进制字符", "z".repeat(64)],
    ["普通口令", "password"],
    ["空字符串", ""],
    ["纯空白", "   "],
    ["前后空白填充", `  ${"a".repeat(64)}  `],
    ["尾部换行", `${"a".repeat(64)}\n`],
  ] as const;

  it("只要被设置就必须严格合法，空串与空白均报错且不回退本地密钥", async () => {
    await withTempDir(async (dir) => {
      fileProvider({ dataDir: dir })(true);
      for (const [name, value] of invalidValues) {
        const err = expectCode(
          () => createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: value } })(true),
          CONFIG_ENCRYPTION_ERROR
        );
        const trimmed = value.trim();
        if (trimmed !== "") {
          assert.equal(err.message.includes(trimmed), false, `错误信息不应包含环境变量取值（${name}）`);
        }
      }
    });
  });

  it("环境变量未设置（undefined）时回退本地密钥来源", async () => {
    await withTempDir(async (dir) => {
      const fileMaterial = fileProvider({ dataDir: dir })(true);
      const unset = createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: undefined } })(false);
      assert.equal(unset.id, fileMaterial.id);
      const absent = createConfigKeyProvider({ dataDir: dir, env: {} })(false);
      assert.equal(absent.id, fileMaterial.id);
    });
  });

  it("本地密钥身份与环境密钥不符时拒绝使用", async () => {
    await withTempDir(async (dir) => {
      const fileMaterial = fileProvider({ dataDir: dir })(true);
      const other = hexKey(randomBytes(32));
      expectCode(
        () => createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: other } })(true),
        CONFIG_ENCRYPTION_ERROR
      );
      expectCode(
        () => createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: other } })(false),
        CONFIG_ENCRYPTION_ERROR
      );
      assert.equal(Buffer.from(readFileSync(keyPaths(dir).keyPath)).toString("hex"), hexKey(Buffer.from(fileMaterial.key)));
    });
  });

  it("环境来源不因缺少本地密钥文件而绕过目录与标记安全校验", async () => {
    await withTempDir(async (dir) => {
      const { keyDir, markerPath } = keyPaths(dir);
      const bytes = randomBytes(32);
      createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: hexKey(bytes) } })(true);
      chmodSync(keyDir, 0o755);
      expectCode(
        () => createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: hexKey(bytes) } })(false),
        CONFIG_ENCRYPTION_ERROR
      );
      chmodSync(keyDir, 0o700);
      chmodSync(markerPath, 0o644);
      expectCode(
        () => createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: hexKey(bytes) } })(false),
        CONFIG_ENCRYPTION_ERROR
      );
    });
  });
});

describe("createConfigKeyProvider 延迟钉住身份", () => {
  it("env 提供器先只读后允许创建时补建身份标记", async () => {
    await withTempDir(async (dir) => {
      const { keyPath, markerPath } = keyPaths(dir);
      const bytes = randomBytes(32);
      const provider = createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: hexKey(bytes) } });
      const material = provider(false);
      assert.equal(existsSync(markerPath), false, "只读调用不得创建任何文件");
      assert.equal(existsSync(keyPath), false);

      const pinned = provider(true);
      assert.equal(pinned.id, material.id);
      assert.equal(readFileSync(markerPath, "utf8").trim(), material.id);
      assert.equal(existsSync(keyPath), false, "env 来源不得生成本地密钥文件");
    });
  });

  it("env 提供器钉住身份后环境丢失，新提供器拒绝再生密钥", async () => {
    await withTempDir(async (dir) => {
      const { keyPath } = keyPaths(dir);
      const provider = createConfigKeyProvider({
        dataDir: dir,
        env: { [ENV_KEY_NAME]: hexKey(randomBytes(32)) },
      });
      const material = provider(false);
      provider(true);
      expectCode(() => fileProvider({ dataDir: dir })(true), CONFIG_ENCRYPTION_ERROR);
      assert.equal(existsSync(keyPath), false);
      const restored = createConfigKeyProvider({
        dataDir: dir,
        env: { [ENV_KEY_NAME]: hexKey(Buffer.from(material.key)) },
      })(false);
      assert.equal(restored.id, material.id);
    });
  });

  it("钉住时使用首次加载的材料而非调用时的环境快照", async () => {
    await withTempDir(async (dir) => {
      const { markerPath } = keyPaths(dir);
      const first = randomBytes(32);
      const env: Record<string, string | undefined> = { [ENV_KEY_NAME]: hexKey(first) };
      const provider = createConfigKeyProvider({ dataDir: dir, env });
      const material = provider(false);
      env[ENV_KEY_NAME] = hexKey(randomBytes(32));
      const pinned = provider(true);
      assert.equal(pinned.id, material.id);
      assert.equal(readFileSync(markerPath, "utf8").trim(), configKeyId(first));
    });
  });

  it("文件提供器先只读后允许创建时补建身份标记", async () => {
    await withTempDir(async (dir) => {
      const { keyDir, keyPath, markerPath } = keyPaths(dir);
      mkdirSync(keyDir, { recursive: true, mode: 0o700 });
      chmodSync(keyDir, 0o700);
      const material = randomBytes(32);
      writeFileSync(keyPath, material, { mode: 0o600 });
      chmodSync(keyPath, 0o600);

      const provider = fileProvider({ dataDir: dir });
      const read = provider(false);
      assert.equal(read.id, configKeyId(material));
      assert.equal(existsSync(markerPath), false);

      const completed = provider(true);
      assert.equal(completed.id, configKeyId(material));
      assert.equal(readFileSync(markerPath, "utf8").trim(), configKeyId(material));
      assert.deepEqual(Buffer.from(readFileSync(keyPath)), material);
    });
  });
});

describe("createConfigKeyProvider 本地密钥", () => {
  it("延迟执行：构造与只读调用前不创建目录", async () => {
    await withTempDir(async (dir) => {
      const provider = fileProvider({ dataDir: dir });
      assert.equal(existsSync(join(dir, "keys")), false);
      expectCode(() => provider(false), CONFIG_ENCRYPTION_ERROR);
      assert.equal(existsSync(join(dir, "keys")), false);
      const material = provider(true);
      assert.match(material.id, /^[0-9a-f]{64}$/);
      assert.equal(material.id, configKeyId(Buffer.from(material.key)));
    });
  });

  it("生成文件与目录权限严格满足 700 与 600", async () => {
    await withTempDir(async (dir) => {
      const { keyDir, keyPath, markerPath } = keyPaths(dir);
      const material = fileProvider({ dataDir: dir })(true);
      assert.equal(lstatSync(keyDir).mode & 0o777, 0o700);
      assert.equal(lstatSync(keyPath).mode & 0o777, 0o600);
      assert.equal(lstatSync(keyPath).isFile(), true);
      assert.equal(readFileSync(keyPath).byteLength, 32);
      assert.equal(readFileSync(markerPath, "utf8").trim(), material.id);
      assert.equal(lstatSync(markerPath).mode & 0o777, 0o600);
    });
  });

  it("发布完成后目录内不残留临时文件", async () => {
    await withTempDir(async (dir) => {
      const { keyDir } = keyPaths(dir);
      fileProvider({ dataDir: dir })(true);
      assert.deepEqual(readdirSync(keyDir).sort(), ["config.key", "config.key.id"]);
    });
  });

  it("后续读取与再次允许创建均复用既有密钥", async () => {
    await withTempDir(async (dir) => {
      const first = fileProvider({ dataDir: dir })(true);
      const second = fileProvider({ dataDir: dir })(true);
      assert.equal(second.id, first.id);
      const third = fileProvider({ dataDir: dir })(false);
      assert.equal(third.id, first.id);
    });
  });

  it("customHome 定位用户主目录下的密钥，dataDir 优先于 customHome", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dataDir) => {
        const homeMaterial = fileProvider({ customHome: home })(true);
        const homeKeyPath = join(home, ".actiondock", "keys", "config.key");
        assert.equal(existsSync(homeKeyPath), true);
        assert.equal(readFileSync(homeKeyPath).byteLength, 32);

        const dataMaterial = fileProvider({ customHome: home, dataDir })(true);
        assert.equal(existsSync(join(dataDir, "keys", "config.key")), true);
        assert.notEqual(dataMaterial.id, homeMaterial.id);
      });
    });
  });

  it("同一提供器首次成功后缓存材料，之后环境与文件变化不再读取", async () => {
    await withTempDir(async (dir) => {
      const env: Record<string, string | undefined> = { [ENV_KEY_NAME]: hexKey(randomBytes(32)) };
      const provider = createConfigKeyProvider({ dataDir: dir, env });
      const first = provider(true);
      env[ENV_KEY_NAME] = hexKey(randomBytes(32));
      const second = provider(true);
      assert.equal(second.id, first.id);
    });
    await withTempDir(async (dir) => {
      const { keyPath } = keyPaths(dir);
      const provider = fileProvider({ dataDir: dir });
      const fileFirst = provider(true);
      unlinkSync(keyPath);
      const fileSecond = provider(true);
      assert.equal(fileSecond.id, fileFirst.id);
      assert.equal(existsSync(keyPath), false);
    });
  });
});

describe("createConfigKeyProvider 身份保护", () => {
  it("密钥文件丢失而标记存在时拒绝再生新密钥", async () => {
    await withTempDir(async (dir) => {
      const { keyPath } = keyPaths(dir);
      const material = fileProvider({ dataDir: dir })(true);
      unlinkSync(keyPath);
      expectCode(() => fileProvider({ dataDir: dir })(true), CONFIG_ENCRYPTION_ERROR);
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
      assert.equal(existsSync(keyPath), false);
      void material;
    });
  });

  it("标记指纹与实际密钥不符时拒绝", async () => {
    await withTempDir(async (dir) => {
      const { keyPath } = keyPaths(dir);
      fileProvider({ dataDir: dir })(true);
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
      chmodSync(keyPath, 0o600);
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
      expectCode(() => fileProvider({ dataDir: dir })(true), CONFIG_ENCRYPTION_ERROR);
    });
  });

  it("切换到另一把有效环境密钥时拒绝写入历史存储域", async () => {
    await withTempDir(async (dir) => {
      const first = hexKey(randomBytes(32));
      createConfigKeyProvider({ dataDir: dir, env: { [ENV_KEY_NAME]: first } })(true);
      expectCode(
        () =>
          createConfigKeyProvider({
            dataDir: dir,
            env: { [ENV_KEY_NAME]: hexKey(randomBytes(32)) },
          })(true),
        CONFIG_ENCRYPTION_ERROR
      );
    });
  });

  it("标记损坏时报错而非忽略", async () => {
    await withTempDir(async (dir) => {
      const { markerPath } = keyPaths(dir);
      fileProvider({ dataDir: dir })(true);
      writeFileSync(markerPath, "not-a-fingerprint", { mode: 0o600 });
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
    });
  });
});

describe("createConfigKeyProvider 文件安全校验", () => {
  it("拒绝符号链接密钥文件", async () => {
    await withTempDir(async (dir) => {
      const { keyPath } = keyPaths(dir);
      fileProvider({ dataDir: dir })(true);
      const real = join(dir, "real-key");
      writeFileSync(real, randomBytes(32), { mode: 0o600 });
      unlinkSync(keyPath);
      symlinkSync(real, keyPath);
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
    });
  });

  it("拒绝符号链接密钥目录", async () => {
    await withTempDir(async (dir) => {
      const { keyDir } = keyPaths(dir);
      const realDir = join(dir, "real-keys");
      mkdirSync(realDir, { mode: 0o700 });
      writeFileSync(join(realDir, "config.key"), randomBytes(32), { mode: 0o600 });
      symlinkSync(realDir, keyDir);
      expectCode(() => fileProvider({ dataDir: dir })(true), CONFIG_ENCRYPTION_ERROR);
    });
  });

  it("拒绝不安全权限的密钥文件、标记与目录", async () => {
    await withTempDir(async (dir) => {
      const { keyDir, keyPath, markerPath } = keyPaths(dir);
      fileProvider({ dataDir: dir })(true);
      chmodSync(keyPath, 0o644);
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
      chmodSync(keyPath, 0o600);
      chmodSync(keyPath, 0o400);
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
      chmodSync(keyPath, 0o600);
      chmodSync(markerPath, 0o644);
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
      chmodSync(markerPath, 0o600);
      chmodSync(keyDir, 0o755);
      expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
    });
  });

  it("拒绝长度不正确的密钥文件", async () => {
    await withTempDir(async (dir) => {
      const { keyPath } = keyPaths(dir);
      for (const length of [0, 16, 31, 33, 64]) {
        mkdirSync(join(dir, "keys"), { recursive: true, mode: 0o700 });
        writeFileSync(keyPath, randomBytes(length), { mode: 0o600 });
        expectCode(() => fileProvider({ dataDir: dir })(false), CONFIG_ENCRYPTION_ERROR);
        rmSync(join(dir, "keys"), { recursive: true, force: true });
      }
    });
  });
});

describe("createConfigKeyProvider 并发首次初始化", () => {
  it("多进程同时竞争创建时全部收敛到同一密钥且无临时残留", { timeout: 60000 }, async () => {
    await withTempDir(async (dir) => {
      const { keyDir, keyPath, markerPath } = keyPaths(dir);
      const modulePath = resolve(import.meta.dirname, "../src/security/config-key.ts");
      const workerScript = join(dir, "key-worker.mjs");
      writeFileSync(
        workerScript,
        `
import { createConfigKeyProvider } from ${JSON.stringify(pathToFileURL(modulePath).href)};
const dataDir = process.argv[2];
const create = process.argv[3] === "create";
try {
  const material = createConfigKeyProvider({ dataDir, env: {} })(create);
  process.stdout.write("ID:" + material.id + "\\n");
} catch (err) {
  process.stdout.write("ERR:" + (err?.code || err?.message) + "\\n");
  process.exit(1);
}
`,
        "utf-8"
      );

      const isBun = Boolean((process as any).isBun || process.versions?.bun);
      const repoRoot = resolve(import.meta.dirname, "../../..");
      const preloadUrl = pathToFileURL(join(repoRoot, "scripts", "test-preload.ts")).href;
      const childEnv = { ...process.env };
      delete childEnv[ENV_KEY_NAME];
      const childArgs = (create: string) =>
        isBun ? [workerScript, dir, create] : ["--no-deprecation", "--import", preloadUrl, workerScript, dir, create];

      const spawnWorker = (create: string) =>
        new Promise<{ code: number | null; output: string }>((resolvePromise) => {
          const child = spawn(process.execPath, childArgs(create), {
            stdio: ["ignore", "pipe", "inherit"],
            env: childEnv,
          });
          let output = "";
          child.stdout.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf8");
          });
          child.on("error", (err) => resolvePromise({ code: -1, output: `ERR:${err.message}` }));
          child.on("close", (code) => resolvePromise({ code, output }));
        });

      const creators = await Promise.all(Array.from({ length: 6 }, () => spawnWorker("create")));
      const ids = new Set<string>();
      for (const result of creators) {
        assert.equal(result.code, 0, `并发创建进程异常退出: ${result.output}`);
        assert.match(result.output, /^ID:[0-9a-f]{64}\n$/);
        ids.add(result.output.trim().slice(3));
      }
      assert.equal(ids.size, 1, "全部竞争进程必须收敛到同一密钥指纹");

      const readers = await Promise.all(Array.from({ length: 4 }, () => spawnWorker("read")));
      for (const result of readers) {
        assert.equal(result.code, 0, `并发读取进程异常退出: ${result.output}`);
        assert.equal(`ID:${[...ids][0]}\n`, result.output);
      }

      assert.deepEqual(readdirSync(keyDir).sort(), ["config.key", "config.key.id"]);
      assert.equal(readFileSync(keyPath).byteLength, 32);
      assert.equal(lstatSync(keyPath).mode & 0o777, 0o600);
      assert.equal(readFileSync(markerPath, "utf8").trim(), [...ids][0]);
    });
  });
});
