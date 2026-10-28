import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  configKeyId,
  decryptConfigValue,
  encryptConfigValue,
  isEncryptedConfigValue,
  type ConfigEncryptionKey,
} from "../src/security/config-cipher";
import { CONFIG_DECRYPT_FAILED, CONFIG_ENCRYPTION_ERROR } from "../src/errors";

const SCOPE = "com.example.pkg";
const KEY = "DB_PASSWORD";

function makeMaterial(bytes?: Uint8Array): ConfigEncryptionKey {
  const key = bytes ?? randomBytes(32);
  return { key, id: configKeyId(key) };
}

function expectCode(fn: () => unknown, code: string): { code: string; message: string; details?: unknown } {
  try {
    fn();
  } catch (err: any) {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return err;
  }
  assert.fail(`expected error with code ${code} to be thrown`);
}

/**
 * 按规范手工构造合法信封，用于验证解密侧对非法 JSON 负载的严格拒绝。
 * 附加认证数据格式为规范约定：JSON 数组绑定 [adenc:v1, 指纹, scope, key]。
 */
function craftEnvelopeWithPlaintext(
  plaintext: string,
  material: ConfigEncryptionKey,
  scope: string,
  key: string
): string {
  const iv = randomBytes(12);
  const aad = Buffer.from(JSON.stringify(["adenc:v1", material.id, scope, key]), "utf8");
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(material.key), iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `adenc:v1:${material.id}:${Buffer.concat([iv, ciphertext, tag]).toString("base64url")}`;
}

describe("configKeyId 密钥指纹", () => {
  it("输出 64 位小写十六进制且对相同密钥稳定", () => {
    const key = randomBytes(32);
    const id = configKeyId(key);
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(configKeyId(key), id);
    assert.equal(configKeyId(Buffer.from(key)), id);
  });

  it("不同密钥产生不同指纹", () => {
    assert.notEqual(configKeyId(randomBytes(32)), configKeyId(randomBytes(32)));
  });

  it("拒绝空或非法密钥材料", () => {
    expectCode(() => configKeyId(new Uint8Array(0)), CONFIG_ENCRYPTION_ERROR);
    expectCode(() => configKeyId(undefined as any), CONFIG_ENCRYPTION_ERROR);
  });
});

describe("encryptConfigValue 信封格式", () => {
  it("产出规范信封且携带密钥指纹", () => {
    const material = makeMaterial();
    const envelope = encryptConfigValue("secret", SCOPE, KEY, material);
    assert.match(envelope, /^adenc:v1:[0-9a-f]{64}:[A-Za-z0-9_-]+$/);
    assert.ok(envelope.includes(material.id));
    assert.equal(isEncryptedConfigValue(envelope), true);
  });

  it("相同明文两次加密使用随机初始向量产生不同密文", () => {
    const material = makeMaterial();
    const first = encryptConfigValue("same-value", SCOPE, KEY, material);
    const second = encryptConfigValue("same-value", SCOPE, KEY, material);
    assert.notEqual(first, second);
    assert.equal(decryptConfigValue(first, SCOPE, KEY, material), "same-value");
    assert.equal(decryptConfigValue(second, SCOPE, KEY, material), "same-value");
  });
});

describe("encryptConfigValue 严格可序列化", () => {
  const material = makeMaterial();
  const cases: Array<[string, unknown]> = [
    ["字符串", "text-value"],
    ["空字符串", ""],
    ["零", 0],
    ["负浮点", -1.5],
    ["大数值", 1e308],
    ["真", true],
    ["假", false],
    ["空值", null],
    ["空对象", {}],
    ["空数组", []],
    ["嵌套结构", { a: { b: [1, "two", null, { c: [] }] } }],
    ["Unicode 字符串", "敏感配置值-ünïcødé-测试"],
    ["长字符串", "x".repeat(4096)],
  ];

  it("完整类型往返精确还原", () => {
    for (const [name, value] of cases) {
      const envelope = encryptConfigValue(value, SCOPE, KEY, material);
      const restored = decryptConfigValue(envelope, SCOPE, KEY, material);
      assert.deepEqual(restored, value, `round-trip failed for ${name}`);
    }
  });

  const invalid: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["函数", () => 1],
    ["符号", Symbol("s")],
    ["BigInt", 10n],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["负 Infinity", -Infinity],
    ["对象属性 undefined", { a: undefined }],
    ["数组元素 undefined", [undefined]],
  ];

  it("拒绝任何不能精确 JSON 往返的值", () => {
    for (const [name, value] of invalid) {
      expectCode(() => encryptConfigValue(value, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);
      void name;
    }
  });

  it("拒绝循环引用", () => {
    const circular: any = { name: "cycle" };
    circular.self = circular;
    expectCode(() => encryptConfigValue(circular, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);
  });

  it("拒绝非 plain 对象与变形结构", () => {
    const exotic: Array<[string, unknown]> = [
      ["Date", new Date(0)],
      ["Map", new Map([["a", 1]])],
      ["Set", new Set([1])],
      ["正则", /x/],
      ["稀疏数组", [1, , 3]],
      ["数组子类", new (class extends Array<number> {})()],
      ["对象子类", new (class Box { secret = 1 })()],
    ];
    for (const [name, value] of exotic) {
      expectCode(() => encryptConfigValue(value, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);
      void name;
    }
  });

  it("拒绝符号键、非枚举属性与访问器且不执行 getter", () => {
    const symbolKeyed: Record<string, unknown> = {};
    (symbolKeyed as any)[Symbol("hidden")] = 1;
    expectCode(() => encryptConfigValue(symbolKeyed, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);

    const nonEnumerable: Record<string, unknown> = {};
    Object.defineProperty(nonEnumerable, "a", { value: 1, enumerable: false });
    expectCode(() => encryptConfigValue(nonEnumerable, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);

    let getterInvoked = false;
    const accessor = {
      get token(): string {
        getterInvoked = true;
        return "v";
      },
    };
    expectCode(() => encryptConfigValue(accessor, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);
    assert.equal(getterInvoked, false, "校验阶段不得执行 getter");
  });

  it("getter 抛出含秘密的异常时错误不携带异常内容", () => {
    const malicious = {
      get token(): string {
        throw new Error("SECRET-GETTER-THROWN-MARKER");
      },
    };
    const err = expectCode(() => encryptConfigValue(malicious, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);
    assert.equal(err.message.includes("SECRET-GETTER-THROWN-MARKER"), false);
    const details = JSON.stringify(err.details ?? {});
    assert.equal(details.includes("SECRET-GETTER-THROWN-MARKER"), false);
    assert.equal(details.includes("reason"), false);
    assert.equal(details.includes("path"), false);
  });

  it("null 原型对象作为 plain 对象接受并精确序列化", () => {
    const value = Object.assign(Object.create(null), { a: 1, b: [true] }) as unknown;
    const envelope = encryptConfigValue(value, SCOPE, KEY, material);
    const restored = decryptConfigValue(envelope, SCOPE, KEY, material) as unknown;
    assert.equal(JSON.stringify(restored), JSON.stringify({ a: 1, b: [true] }));
  });

  it("拒绝超过深度上限的嵌套", () => {
    let deep: any = { leaf: true };
    for (let i = 0; i < 1024; i++) {
      deep = { child: deep };
    }
    expectCode(() => encryptConfigValue(deep, SCOPE, KEY, material), CONFIG_ENCRYPTION_ERROR);
  });

  it("序列化失败错误不泄露值内容且 details 仅含固定字段", () => {
    const err = expectCode(
      () => encryptConfigValue({ token: "LEAKED-PLAINTEXT-MARKER", bad: undefined }, SCOPE, KEY, material),
      CONFIG_ENCRYPTION_ERROR
    );
    assert.equal(err.message.includes("LEAKED-PLAINTEXT-MARKER"), false);
    const details = err.details as Record<string, unknown>;
    assert.equal(JSON.stringify(details).includes("LEAKED-PLAINTEXT-MARKER"), false);
    assert.equal("reason" in details, false);
    assert.equal("path" in details, false);
    assert.equal(typeof details.code, "string");
  });

  it("拒绝空 scope 或空键名", () => {
    expectCode(() => encryptConfigValue("v", "", KEY, material), CONFIG_ENCRYPTION_ERROR);
    expectCode(() => encryptConfigValue("v", SCOPE, "", material), CONFIG_ENCRYPTION_ERROR);
    expectCode(() => decryptConfigValue("adenc:v1:x", "", KEY, material), CONFIG_ENCRYPTION_ERROR);
    expectCode(() => decryptConfigValue("adenc:v1:x", SCOPE, "", material), CONFIG_ENCRYPTION_ERROR);
  });
});

describe("encryptConfigValue 密钥材料校验", () => {
  it("拒绝长度不正确的密钥", () => {
    expectCode(() => encryptConfigValue("v", SCOPE, KEY, makeMaterial(randomBytes(16))), CONFIG_ENCRYPTION_ERROR);
    expectCode(() => encryptConfigValue("v", SCOPE, KEY, makeMaterial(randomBytes(33))), CONFIG_ENCRYPTION_ERROR);
  });

  it("拒绝非 Uint8Array 密钥", () => {
    expectCode(
      () => encryptConfigValue("v", SCOPE, KEY, { key: "not-bytes" as any, id: "a".repeat(64) }),
      CONFIG_ENCRYPTION_ERROR
    );
  });

  it("拒绝与指纹不一致的材料", () => {
    const key = randomBytes(32);
    expectCode(
      () => encryptConfigValue("v", SCOPE, KEY, { key, id: configKeyId(randomBytes(32)) }),
      CONFIG_ENCRYPTION_ERROR
    );
    expectCode(() => encryptConfigValue("v", SCOPE, KEY, { key, id: "SHORT" }), CONFIG_ENCRYPTION_ERROR);
    expectCode(
      () => encryptConfigValue("v", SCOPE, KEY, { key, id: configKeyId(key).toUpperCase() }),
      CONFIG_ENCRYPTION_ERROR
    );
    expectCode(() => decryptConfigValue("adenc:v1:a:b", SCOPE, KEY, null as any), CONFIG_ENCRYPTION_ERROR);
  });
});

describe("decryptConfigValue 附加认证数据绑定", () => {
  it("scope 不匹配时解密失败", () => {
    const material = makeMaterial();
    const envelope = encryptConfigValue("bound-value", SCOPE, KEY, material);
    expectCode(() => decryptConfigValue(envelope, "other.scope", KEY, material), CONFIG_DECRYPT_FAILED);
  });

  it("key 不匹配时解密失败", () => {
    const material = makeMaterial();
    const envelope = encryptConfigValue("bound-value", SCOPE, KEY, material);
    expectCode(() => decryptConfigValue(envelope, SCOPE, "OTHER_KEY", material), CONFIG_DECRYPT_FAILED);
  });

  it("scope 与 key 交叉挪用时解密失败", () => {
    const material = makeMaterial();
    const first = encryptConfigValue("v1", "scope.a", "KEY_ONE", material);
    const second = encryptConfigValue("v2", "scope.b", "KEY_TWO", material);
    expectCode(() => decryptConfigValue(first, "scope.b", "KEY_TWO", material), CONFIG_DECRYPT_FAILED);
    expectCode(() => decryptConfigValue(second, "scope.a", "KEY_ONE", material), CONFIG_DECRYPT_FAILED);
  });

  it("不同密钥材料的密文互解失败", () => {
    const writer = makeMaterial();
    const reader = makeMaterial();
    const envelope = encryptConfigValue("cross-key", SCOPE, KEY, writer);
    const err = expectCode(() => decryptConfigValue(envelope, SCOPE, KEY, reader), CONFIG_DECRYPT_FAILED);
    assert.equal(err.message.includes("cross-key"), false);
  });
});

describe("decryptConfigValue 严格拒绝不规范输入", () => {
  const material = makeMaterial();

  const tamperPayload = (envelope: string, mutate: (payload: string) => string): string => {
    const parts = envelope.split(":");
    parts[3] = mutate(parts[3]);
    return parts.join(":");
  };

  it("非密文输入直接失败", () => {
    expectCode(() => decryptConfigValue("plain-value", SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    expectCode(() => decryptConfigValue("", SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
  });

  it("未知版本严格报错且不降级", () => {
    const envelope = encryptConfigValue("v", SCOPE, KEY, material);
    for (const version of ["v0", "v2", "v10", "v999"]) {
      const crafted = envelope.replace(":v1:", `:${version}:`);
      const err = expectCode(() => decryptConfigValue(crafted, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
      assert.equal(err.message.includes(version), true);
    }
  });

  it("未知版本仍被识别为密文", () => {
    assert.equal(isEncryptedConfigValue("adenc:v2:whatever"), true);
    assert.equal(isEncryptedConfigValue("adenc:"), true);
    assert.equal(isEncryptedConfigValue("plain"), false);
    assert.equal(isEncryptedConfigValue("adenc"), false);
    assert.equal(isEncryptedConfigValue("ADENC:v1:x"), false);
    assert.equal(isEncryptedConfigValue(undefined as any), false);
  });

  it("篡改负载任意字符均认证失败", () => {
    const envelope = encryptConfigValue("tamper-target", SCOPE, KEY, material);
    const payload = envelope.split(":")[3];
    for (let i = 0; i < payload.length; i += Math.max(1, Math.floor(payload.length / 6))) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const original = payload[i];
      const replacement = chars[(chars.indexOf(original) + 1) % chars.length];
      const mutated = payload.slice(0, i) + replacement + payload.slice(i + 1);
      const crafted = tamperPayload(envelope, () => mutated);
      expectCode(() => decryptConfigValue(crafted, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    }
  });

  it("截断负载失败", () => {
    const envelope = encryptConfigValue("truncation", SCOPE, KEY, material);
    expectCode(
      () => decryptConfigValue(tamperPayload(envelope, (p) => p.slice(0, -1)), SCOPE, KEY, material),
      CONFIG_DECRYPT_FAILED
    );
    expectCode(
      () => decryptConfigValue(tamperPayload(envelope, (p) => p.slice(1)), SCOPE, KEY, material),
      CONFIG_DECRYPT_FAILED
    );
  });

  it("拒绝填充与非规范 base64url 字符", () => {
    const envelope = encryptConfigValue("padding", SCOPE, KEY, material);
    expectCode(
      () => decryptConfigValue(tamperPayload(envelope, (p) => `${p}=`), SCOPE, KEY, material),
      CONFIG_DECRYPT_FAILED
    );
    expectCode(
      () => decryptConfigValue(tamperPayload(envelope, (p) => `+${p.slice(1)}`), SCOPE, KEY, material),
      CONFIG_DECRYPT_FAILED
    );
    expectCode(
      () => decryptConfigValue(tamperPayload(envelope, (p) => `/${p.slice(1)}`), SCOPE, KEY, material),
      CONFIG_DECRYPT_FAILED
    );
  });

  it("拒绝非规范指纹段", () => {
    const envelope = encryptConfigValue("fingerprint", SCOPE, KEY, material);
    const parts = envelope.split(":");
    const uppercase = [parts[0], parts[1], material.id.toUpperCase(), parts[3]].join(":");
    expectCode(() => decryptConfigValue(uppercase, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    const short = [parts[0], parts[1], material.id.slice(0, 63), parts[3]].join(":");
    expectCode(() => decryptConfigValue(short, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    const foreign = [parts[0], parts[1], configKeyId(randomBytes(32)), parts[3]].join(":");
    expectCode(() => decryptConfigValue(foreign, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
  });

  it("拒绝结构残缺的信封", () => {
    const envelope = encryptConfigValue("shape", SCOPE, KEY, material);
    expectCode(() => decryptConfigValue("adenc:v1", SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    expectCode(() => decryptConfigValue("adenc:v1:", SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    expectCode(() => decryptConfigValue(`${envelope}:extra`, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    expectCode(
      () => decryptConfigValue("adenc:vX:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:AAAA", SCOPE, KEY, material),
      CONFIG_DECRYPT_FAILED
    );
  });

  it("认证通过但负载不是合法 JSON 时失败且不泄露内容", () => {
    const crafted = craftEnvelopeWithPlaintext("XXINVALIDJSONXX", material, SCOPE, KEY);
    const err = expectCode(() => decryptConfigValue(crafted, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
    assert.equal(err.message.includes("XXINVALIDJSONXX"), false);
    assert.equal(JSON.stringify(err.details ?? {}).includes("XXINVALIDJSONXX"), false);
  });

  it("认证通过但负载含重复键时失败", () => {
    const crafted = craftEnvelopeWithPlaintext('{"a":1,"a":2}', material, SCOPE, KEY);
    expectCode(() => decryptConfigValue(crafted, SCOPE, KEY, material), CONFIG_DECRYPT_FAILED);
  });

  it("所有失败路径的错误信息不含密文负载与密钥材料", () => {
    const envelope = encryptConfigValue("SECRET-PLAINTEXT-MARKER", SCOPE, KEY, material);
    const payload = envelope.split(":")[3];
    const attempts: Array<() => unknown> = [
      () => decryptConfigValue(tamperPayload(envelope, (p) => p.slice(0, -2)), SCOPE, KEY, material),
      () => decryptConfigValue(envelope.replace(":v1:", ":v7:"), SCOPE, KEY, material),
      () => decryptConfigValue(envelope, "other.scope", KEY, material),
    ];
    for (const attempt of attempts) {
      const err = expectCode(attempt, CONFIG_DECRYPT_FAILED) as any;
      assert.equal(err.message.includes("SECRET-PLAINTEXT-MARKER"), false);
      assert.equal(err.message.includes(payload), false);
      assert.equal(err.message.includes(Buffer.from(material.key).toString("hex")), false);
    }
  });
});
