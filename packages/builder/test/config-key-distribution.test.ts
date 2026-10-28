import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { SelectionPlanner } from "../src/planner";
import { exportSkill } from "../src/exporter";
import { isRuntimeConfigFile } from "../src/dependency-resolver";
import { collectRelativeFiles } from "../src/fs-utils";

/**
 * 配置加密主密钥分发隔离测试。
 *
 * 密钥布局事实源为 core/security/config-key.ts：dataDir 定位为 <dataDir>/keys/config.key，
 * 主目录定位为 .actiondock/keys/config.key；身份标记 config.key.id 与残留临时文件
 * .{原名}.tmp.{pid}.{uuid} 同处密钥目录。用户把 dataDir 放进工程内时，
 * 密钥资产不得被 assets 通配选中带入 build/pack/Skill 导出产物，
 * 而普通业务 keys 目录与普通 *.key 业务资产不受影响。
 */
describe("配置加密密钥文件分发隔离", () => {
  let tempDir: string;
  let projectRoot: string;
  let outDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-config-key-test-"));
    projectRoot = join(tempDir, "project");
    outDir = join(tempDir, "out");
    mkdirSync(join(projectRoot, "actions"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  /** 写入主密钥文件内容（32 字节原始材料，内容本身不参与规划判断） */
  const KEY_MATERIAL = Buffer.alloc(32, 0xab);

  /**
   * 搭建标准工程：assets 声明 data 目录，
   * 内含密钥目录 data/keys（密钥、身份标记、残留临时文件与普通业务资产并存）
   * 与密钥目录外的同名业务资产及业务 bindings.json。
   */
  const writeProject = () => {
    writeFileSync(
      join(projectRoot, "actiondock.json"),
      JSON.stringify({
        schemaVersion: 2,
        id: "pkg.config-key-guard",
        version: "1.0.0",
        actions: { noop: { entry: "actions/noop.js" } },
        assets: ["data"],
      }),
      "utf-8"
    );
    writeFileSync(join(projectRoot, "actions", "noop.js"), "export default { run: () => ({}) };");

    const keyDir = join(projectRoot, "data", "keys");
    mkdirSync(keyDir, { recursive: true });

    // 密钥目录内的 ActionDock 密钥资产：主密钥、身份标记与发布残留临时文件
    writeFileSync(join(keyDir, "config.key"), KEY_MATERIAL);
    writeFileSync(join(keyDir, "config.key.id"), `${"a".repeat(64)}\n`, "utf-8");
    writeFileSync(
      join(keyDir, ".config.key.tmp.123.11111111-2222-3333-4444-555555555555"),
      KEY_MATERIAL
    );
    writeFileSync(
      join(keyDir, ".config.key.id.tmp.123.66666666-7777-8888-9999-000000000000"),
      `${"b".repeat(64)}\n`,
      "utf-8"
    );

    // 密钥目录内的普通业务资产：不得被一概排除
    writeFileSync(join(keyDir, "data.json"), "{\"business\":true}");
    writeFileSync(join(keyDir, "api.key"), "business-api-key");

    // 密钥目录外的业务资产：同名 config.key 与业务 bindings.json 均须保留
    writeFileSync(join(projectRoot, "data", "config.key"), "business-config-key");
    writeFileSync(join(projectRoot, "data", "bindings.json"), "{\"business\":true}");
  };

  it("isRuntimeConfigFile 精确识别密钥资产且不误伤业务资产", () => {
    // 命中：既有运行目录与 profiles 语义保持不变
    assert.equal(isRuntimeConfigFile(".actiondock/bindings.json"), true);
    assert.equal(isRuntimeConfigFile(".actiondock/keys/config.key"), true);
    assert.equal(isRuntimeConfigFile("data/.actiondock/keys/config.key.id"), true);
    assert.equal(isRuntimeConfigFile("profiles.json"), true);
    assert.equal(isRuntimeConfigFile("data/profiles.json"), true);

    // 命中：dataDir 落在工程内时的密钥文件与身份标记
    assert.equal(isRuntimeConfigFile("data/keys/config.key"), true);
    assert.equal(isRuntimeConfigFile("data/keys/config.key.id"), true);
    assert.equal(isRuntimeConfigFile("keys/config.key"), true);

    // 命中：发布残留临时文件 .{原名}.tmp.{pid}.{uuid}
    assert.equal(isRuntimeConfigFile("data/keys/.config.key.tmp.123.some-uuid"), true);
    assert.equal(
      isRuntimeConfigFile("data/keys/.config.key.id.tmp.123.66666666-7777-8888-9999-000000000000"),
      true
    );

    // 命中：反斜杠路径归一化后同样识别
    assert.equal(isRuntimeConfigFile("data\\keys\\config.key"), true);

    // 不命中：普通业务 bindings.json 与密钥目录内的普通业务资产
    assert.equal(isRuntimeConfigFile("data/bindings.json"), false);
    assert.equal(isRuntimeConfigFile("data/keys/data.json"), false);
    assert.equal(isRuntimeConfigFile("data/keys/api.key"), false);

    // 不命中：密钥目录外的同名业务资产与相近命名
    assert.equal(isRuntimeConfigFile("data/config.key"), false);
    assert.equal(isRuntimeConfigFile("config.key"), false);
    assert.equal(isRuntimeConfigFile("data/keystore/config.key"), false);
    assert.equal(isRuntimeConfigFile("data/keys/config.keyid"), false);
    assert.equal(isRuntimeConfigFile("data/keys/.config.key.bak.123.uuid"), false);
  });

  it("assets 目录通配规划排除密钥与临时文件，保留普通业务资产", () => {
    writeProject();
    const plan = SelectionPlanner.plan({ projectRoot });
    const paths = plan.dependencies.modulesAndAssets.map((item) => item.path);

    // 普通业务资产全部保留：业务 keys 目录不整体排除，*.key 不一概排除
    assert.ok(paths.includes("data/keys/data.json"));
    assert.ok(paths.includes("data/keys/api.key"));
    assert.ok(paths.includes("data/config.key"));
    assert.ok(paths.includes("data/bindings.json"));

    // 密钥资产与发布残留临时文件绝不进入分发规划
    assert.equal(paths.includes("data/keys/config.key"), false);
    assert.equal(paths.includes("data/keys/config.key.id"), false);
    assert.equal(
      paths.includes("data/keys/.config.key.tmp.123.11111111-2222-3333-4444-555555555555"),
      false
    );
    assert.equal(
      paths.includes("data/keys/.config.key.id.tmp.123.66666666-7777-8888-9999-000000000000"),
      false
    );
    assert.equal(paths.some((path) => path.startsWith("data/keys/.config.key")), false);
  });

  it("显式声明密钥文件为构建资产被拒绝", () => {
    writeProject();
    assert.throws(
      () => SelectionPlanner.plan({ projectRoot, assets: ["data/keys/config.key"] }),
      (err: any) => {
        assert.equal(err.code, "RESTRICTED_CONFIG_ASSET");
        return true;
      }
    );
    assert.throws(
      () => SelectionPlanner.plan({ projectRoot, files: ["data/keys/config.key.id"] }),
      (err: any) => {
        assert.equal(err.code, "RESTRICTED_CONFIG_ASSET");
        return true;
      }
    );
  });

  it("source 导出实际产物不含密钥资产，业务资产完整保留", async () => {
    writeProject();
    const exportRes = await exportSkill({
      projectRoot,
      outDir,
      mode: "source",
    });
    assert.equal(exportRes.packageId, "pkg.config-key-guard");

    // 导出产物中的密钥目录仅剩普通业务资产，密钥与临时文件无任何落盘
    const exportedKeyDir = join(outDir, "data", "keys");
    assert.ok(existsSync(exportedKeyDir));
    assert.deepStrictEqual(collectRelativeFiles(exportedKeyDir), ["api.key", "data.json"]);

    // 密钥目录外业务资产正常进入导出产物
    assert.ok(existsSync(join(outDir, "data", "config.key")));
    assert.ok(existsSync(join(outDir, "data", "bindings.json")));
  });
});
