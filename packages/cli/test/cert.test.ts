import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  certificateCoversHost,
  collectSanEntries,
  ensureSelfSignedCertificate,
  isCertificateValid,
} from "../src";

describe("Certificate Utilities (cert.ts)", () => {
  const tempHome = mkdtempSync(join(tmpdir(), "actiondock-cert-test-"));

  after(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("collectSanEntries 全面收集包含回环、主机名及自定义绑定的 SAN 项", () => {
    const sans = collectSanEntries("192.168.1.100");
    const dnsNames = sans.filter((s) => s.type === 2).map((s) => s.value);
    const ipAddrs = sans.filter((s) => s.type === 7).map((s) => s.ip);

    assert.ok((dnsNames).includes("localhost"));
    assert.ok((ipAddrs).includes("127.0.0.1"));
    assert.ok((ipAddrs).includes("::1"));
    assert.ok((ipAddrs).includes("192.168.1.100"));
  });

  it("isCertificateValid 能够正确识别有效证书与非法内容", () => {
    assert.strictEqual(isCertificateValid("invalid-cert-content"), false);
    assert.strictEqual(isCertificateValid(""), false);
  });

  it("ensureSelfSignedCertificate 自动签发并缓存自签名证书文件", async () => {
    const pair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "127.0.0.1",
    });

    assert.strictEqual(existsSync(pair.certPath), true);
    assert.strictEqual(existsSync(pair.keyPath), true);
    assert.ok((pair.cert).includes("-----BEGIN CERTIFICATE-----"));
    assert.ok((pair.key).includes("PRIVATE KEY-----"));
    assert.strictEqual(isCertificateValid(pair.cert), true);

    // 检查私钥权限（POSIX 环境下应为 0600）
    if (process.platform !== "win32") {
      const keyStat = statSync(pair.keyPath);
      assert.strictEqual(keyStat.mode & 0o777, 0o600);
    }

    // 第二次调用应命中文件缓存复用
    const cachedPair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "127.0.0.1",
    });

    assert.strictEqual(cachedPair.cert, pair.cert);
    assert.strictEqual(cachedPair.key, pair.key);
    assert.strictEqual(cachedPair.certPath, pair.certPath);
    assert.strictEqual(cachedPair.keyPath, pair.keyPath);
  });

  it("certificateCoversHost 校验 SAN 覆盖范围并在主机切换时触发自动重新签发", async () => {
    const initialPair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "127.0.0.1",
    });

    assert.strictEqual(certificateCoversHost(initialPair.cert, "127.0.0.1"), true);
    assert.strictEqual(certificateCoversHost(initialPair.cert, "localhost"), true);
    assert.strictEqual(certificateCoversHost(initialPair.cert, "10.254.254.254"), false);
    assert.strictEqual(certificateCoversHost("invalid-cert", "127.0.0.1"), false);

    // 当切换绑定主机至未覆盖的 IP 时，自动重新签发覆盖新地址的证书
    const reissuedPair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "10.254.254.254",
    });

    assert.notStrictEqual(reissuedPair.cert, initialPair.cert);
    assert.strictEqual(certificateCoversHost(reissuedPair.cert, "10.254.254.254"), true);
    assert.strictEqual(certificateCoversHost(reissuedPair.cert, "127.0.0.1"), true);
  });
});
