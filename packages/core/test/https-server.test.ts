import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@actiondock/runtime-node";
import {
  checkRemoteHealth,
  createActionDockTarget,
  executeRemoteAction,
  getInsecureDispatcher,
  initProject,
  startActionDockServer,
  type ActionDockServerInstance,
} from "../src";

/**
 * 预置合法的自签名测试证书与私钥静态常量（有效期至 2040 年，包含 localhost 与 127.0.0.1 扩展）。
 * 消除测试环境对外部动态签发工具 selfsigned 的依赖。
 */
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIC2zCCAcOgAwIBAgIJP/2HuPAHYM5SMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMTCWxvY2FsaG9zdDAeFw0yNjA5MTcxNjA3NThaFw00MDAxMDEwMDAwMDBaMBQx
EjAQBgNVBAMTCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
ggEBALoiORr53XBAH+5jG/mI6TF7n6OtLDxBcwWShAnHq2E+cI/gJsuP6HWLGQ+u
+FHftfrOjhOlvnyDpqsGv/0n03lsE48CbmzM1V7foEwAZ5DMeWSw9RB0ZDJVj8Ya
zfQjp5hD28WzjvagZBveaDUuxsMXl+Kra18VWezotiX82kBXFzVUECxG1Y2KjUlN
1cxVId/s1CGS8GZjzRK6w97Bx4p9cophec2dicCrC4SvlJNvx9pIs8XBoW9nsFNu
fZzs3+grVZ4MLrEpaygCV9emmxCZBFmXw2e/0NEuoitImfnJegyfpRlsZ78lT8Ec
jjRsJIGM/hXhoFQTeFV6WSpgxVMCAwEAAaMwMC4wLAYDVR0RBCUwI4IJbG9jYWxo
b3N0hwR/AAABhxAAAAAAAAAAAAAAAAAAAAABMA0GCSqGSIb3DQEBCwUAA4IBAQBI
ef6R4hwAm0PbFBcb7YcperhVMVOmPH7uYFv+3lB9F9i78m1JHoPax5qSNaiROkkI
yS46ZA8rIeaBhp3p91Iw5wpGFr1t4eWdx/RXc4awAtOpG76KATYNpEHyclxTuPC7
k9Bcoek+79Wnq/PsFUO5v6zyFA0W49SZPVjENZ+291WsIi0oPMntDTW/otIfrpuu
QmEmZGWNj3DFWOEuJiyGxooZUOWOPLpZcJJa6PtXRpo62hVdIcZQyg4PpP/Nfrcw
k/fOkUqtT15PfxcCSoVXHOx6o1reLT9fVSVtstnQ2oCdccqnSHPsMhiBwcOaLUuE
UowP0W4DEVUG6asnyXQO
-----END CERTIFICATE-----`;

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC6Ijka+d1wQB/u
Yxv5iOkxe5+jrSw8QXMFkoQJx6thPnCP4CbLj+h1ixkPrvhR37X6zo4Tpb58g6ar
Br/9J9N5bBOPAm5szNVe36BMAGeQzHlksPUQdGQyVY/GGs30I6eYQ9vFs472oGQb
3mg1LsbDF5fiq2tfFVns6LYl/NpAVxc1VBAsRtWNio1JTdXMVSHf7NQhkvBmY80S
usPewceKfXKKYXnNnYnAqwuEr5STb8faSLPFwaFvZ7BTbn2c7N/oK1WeDC6xKWso
AlfXppsQmQRZl8Nnv9DRLqIrSJn5yXoMn6UZbGe/JU/BHI40bCSBjP4V4aBUE3hV
elkqYMVTAgMBAAECggEAQIfW5nxUAjOpHlur+jI2LpqeeP9zw5wpRXhLYJyh1P/x
xF/A83f77qx/zskpfDEkBUURSsx+oup9oPOhIiJplcIbccw0/nFxVAgRqefGABRz
za3v+Hlxt2Wkh9kJKCgoVYjJK9yZpvVqX6MW28FQ1ZhbZxFpEzjyyUjQxZDJFd7D
ZH7gjf6RR6h+PGXgdhrj3C4LJx9fdlbtiXCVuHXUCHOE5fUAUU+f2ImEHKUN0F/T
KK9I4LAsHx8yOpkoE5unNktB/JB4uU34CKZJsRz27pTh+MYWkX0jLxp39CHz05Gq
gxeFsjoPz5run2uGwrVaAkXSgM0wFeP/OZHb5ts0CQKBgQD1DrcKQ7C9eylNDfyD
okKs7+olT4nkt2XbA5ZORkn2wU+sEO1Gi9PaSRa7BZixzzs/LfINmrQFWeDaberU
BMNGIe640ne7N+5dghlcS2m/0Wuit4myhIPropFW6KZDcefFvcGLdAlRztkO3/ac
3lAaCpfsQlyqq8rHkspGZ58enQKBgQDCcfE12f54LX25XZoqFmJuXjcVHNfQI99h
F6XQs29wRMXVD1pIY/vyO/MhkS64yqdw7Xra8ZFbsHIlKbiWdyoH5lH4xUmlPi7n
T3cXP8WPTOFSeKuQpnChBk378b+k6+TtAcQwLt79W4qGMNa7n5ek7gHqqn/StLXs
fglNsOK4rwKBgBg0ON35q5Y7eOvUatFxkFZWZ/EBdyQw/Q1xwEHA7YNCuqTLEzR5
kRYpS+Zy+g7t4fMujY7MbeVtaCkK3DvOsJ7XsSVuHEdQkemIdQrJpAs/Gvt6V05b
ilAWwXYtCmb09ChywpAMiPMclBHFCy2ZQ54e17yNHWv6BdBKblIf3/Z9AoGAOEDe
l8XJaNtAVDBQOXzgXS3EoccGaKD4Lw64WfiPdNtwoIMgi3DhouLVJBDsg2mdp34M
3OqmMvCJFVdMn7s53a80Z9QryjKDP0guG/vHG/4R8doXSHHeg7dfOFRoLT5RrH+m
Uoo82O9y0/+tH/q71GtHAqzw7fR57UFJT8Cs1uECgYBfJcrTR7SlIXUPPwFxVPQ+
9kyF2RHPiv80M3PhoomlskW1iQt+LKZqlwV1YEBDzfc0KZUh1ZX9ScA7n8qOfsev
2GXONF+kTP3OWBu2cllCUGhgipjku/R7i7USNUCdYKLb44qHxL/i1b2ar5qO/S8W
I2cZ4irJUufr8G3jT7aiMQ==
-----END PRIVATE KEY-----`;

describe("Native HTTPS Server and Insecure TLS Support", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "actiondock-https-test-"));
  const projectDir = join(tempDir, "https-project");
  let server: ActionDockServerInstance;
  const TOKEN = "https-test-token-abcdef";

  beforeAll(async () => {
    initProject(projectDir, {
      id: "test.https-app",
      name: "HTTPS Test App",
    });

    server = await startActionDockServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      projectRoot: projectDir,
      tls: {
        cert: TEST_CERT,
        key: TEST_KEY,
      },
    });
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("正确启动 HTTPS 服务并设置 https:// 协议基础 URL", () => {
    expect(server.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
    expect(server.port).toBeGreaterThan(0);
  });

  it("未开启 insecure 时请求自签名 HTTPS 服务端被拒绝校验", async () => {
    let errorOccurred = false;
    try {
      await fetch(`${server.url}/api/v1/health`);
    } catch {
      errorOccurred = true;
    }
    expect(errorOccurred).toBe(true);

    const health = await checkRemoteHealth(server.url, TOKEN, 3000, {
      insecure: false,
    });
    expect(health.ok).toBe(false);
  });

  it("开启 insecure 时 checkRemoteHealth 顺利连通自签名 HTTPS 服务端", async () => {
    const health = await checkRemoteHealth(server.url, TOKEN, 3000, {
      insecure: true,
    });
    expect(health.ok).toBe(true);
    expect(health.status).toBe("healthy");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("直接使用 fetch 配合 getInsecureDispatcher 可正常访问 HTTPS API", async () => {
    const res = await fetch(`${server.url}/api/v1/health`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      dispatcher: getInsecureDispatcher(),
      tls: { rejectUnauthorized: false },
    } as any);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe("healthy");
  });

  it("RemoteActionDockTarget 开启 insecure 时能够通过 HTTPS 进行自省与动作查询", async () => {
    const target = await createActionDockTarget({
      type: "remote",
      serverUrl: server.url,
      token: TOKEN,
      insecure: true,
    });

    try {
      const info = await target.info();
      expect(info.protocolVersion).toBe("2.0");
      expect(Array.isArray(info.packages)).toBe(true);

      const actions = await target.listActions();
      expect(Array.isArray(actions)).toBe(true);
    } finally {
      await target.close();
    }
  });
});
