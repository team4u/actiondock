import { afterAll, describe, expect, it } from "bun:test";
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

  afterAll(() => {
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

    expect(dnsNames).toContain("localhost");
    expect(ipAddrs).toContain("127.0.0.1");
    expect(ipAddrs).toContain("::1");
    expect(ipAddrs).toContain("192.168.1.100");
  });

  it("isCertificateValid 能够正确识别有效证书与非法内容", () => {
    expect(isCertificateValid("invalid-cert-content")).toBe(false);
    expect(isCertificateValid("")).toBe(false);
  });

  it("ensureSelfSignedCertificate 自动签发并缓存自签名证书文件", async () => {
    const pair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "127.0.0.1",
    });

    expect(existsSync(pair.certPath)).toBe(true);
    expect(existsSync(pair.keyPath)).toBe(true);
    expect(pair.cert).toContain("-----BEGIN CERTIFICATE-----");
    expect(pair.key).toContain("PRIVATE KEY-----");
    expect(isCertificateValid(pair.cert)).toBe(true);

    // 检查私钥权限（POSIX 环境下应为 0600）
    if (process.platform !== "win32") {
      const keyStat = statSync(pair.keyPath);
      expect(keyStat.mode & 0o777).toBe(0o600);
    }

    // 第二次调用应命中文件缓存复用
    const cachedPair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "127.0.0.1",
    });

    expect(cachedPair.cert).toBe(pair.cert);
    expect(cachedPair.key).toBe(pair.key);
    expect(cachedPair.certPath).toBe(pair.certPath);
    expect(cachedPair.keyPath).toBe(pair.keyPath);
  });

  it("certificateCoversHost 校验 SAN 覆盖范围并在主机切换时触发自动重新签发", async () => {
    const initialPair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "127.0.0.1",
    });

    expect(certificateCoversHost(initialPair.cert, "127.0.0.1")).toBe(true);
    expect(certificateCoversHost(initialPair.cert, "localhost")).toBe(true);
    expect(certificateCoversHost(initialPair.cert, "10.254.254.254")).toBe(false);
    expect(certificateCoversHost("invalid-cert", "127.0.0.1")).toBe(false);

    // 当切换绑定主机至未覆盖的 IP 时，自动重新签发覆盖新地址的证书
    const reissuedPair = await ensureSelfSignedCertificate({
      customHome: tempHome,
      host: "10.254.254.254",
    });

    expect(reissuedPair.cert).not.toBe(initialPair.cert);
    expect(certificateCoversHost(reissuedPair.cert, "10.254.254.254")).toBe(true);
    expect(certificateCoversHost(reissuedPair.cert, "127.0.0.1")).toBe(true);
  });
});
