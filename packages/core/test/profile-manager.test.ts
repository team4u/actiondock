import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_PROFILES_CONFIG,
  getProfilesFilePath,
  loadProfiles,
  addProfile,
} from "../src/profile/manager";
import { assertSecureTransport } from "../src/profile/client-transport";
import { ActionDockError, INVALID_ARGUMENT } from "../src/errors";

describe("Profiles 配置文件损坏保护", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ad-profile-corrupt-"));

  function writeProfilesRaw(customHome: string, content: string): string {
    const filePath = getProfilesFilePath(customHome);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("JSON 损坏时 loadProfiles 抛错并将原文件留档为 .corrupt", () => {
    const customHome = join(tempRoot, "bad-json");
    const filePath = writeProfilesRaw(customHome, "{ not valid json !!!");

    let caught: any;
    try {
      loadProfiles(customHome);
    } catch (err) {
      caught = err;
    }

    // 抛出带恢复指引的错误，绝不静默返回默认配置
    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(ActionDockError);
    expect(caught.code).toBe(INVALID_ARGUMENT);
    expect(caught.message).toContain(".corrupt");
    expect(caught.message).toContain(filePath);

    // 原文件被留档，损坏内容完整保留，用户可手工恢复
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(`${filePath}.corrupt`)).toBe(true);
    expect(readFileSync(`${filePath}.corrupt`, "utf-8")).toBe("{ not valid json !!!");
  });

  it("顶层结构非法（缺 profiles 字段）时同样留档并抛错", () => {
    const customHome = join(tempRoot, "bad-shape");
    const filePath = writeProfilesRaw(customHome, JSON.stringify({ currentProfile: "local" }));

    expect(() => loadProfiles(customHome)).toThrow(/corrupted/);
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(`${filePath}.corrupt`)).toBe(true);
  });

  it("损坏后 addProfile 不会用默认配置覆写丢失的原始数据", () => {
    const customHome = join(tempRoot, "no-silent-reset");
    const filePath = writeProfilesRaw(customHome, "{ broken");

    // addProfile 内部 loadProfiles 抛错向外透传，不会走到 saveProfiles 覆写
    expect(() =>
      addProfile("prod", { serverUrl: "https://prod.example.com" }, customHome)
    ).toThrow(/corrupted/);

    // 原损坏内容仍完整保留在留档中，未被默认配置覆写
    expect(readFileSync(`${filePath}.corrupt`, "utf-8")).toBe("{ broken");
    expect(existsSync(filePath)).toBe(false);
  });

  it("文件不存在时仍走默认初始化", () => {
    const customHome = join(tempRoot, "missing-file");
    const profiles = loadProfiles(customHome);
    expect(profiles).toEqual(DEFAULT_PROFILES_CONFIG);
    expect(profiles.currentProfile).toBe("local");
  });

  it("合法配置文件正常加载", () => {
    const customHome = join(tempRoot, "valid-file");
    const filePath = writeProfilesRaw(
      customHome,
      JSON.stringify({
        currentProfile: "prod",
        profiles: {
          prod: { serverUrl: "https://prod.example.com" },
        },
      })
    );

    const profiles = loadProfiles(customHome);
    expect(profiles.currentProfile).toBe("prod");
    expect(profiles.profiles.prod?.serverUrl).toBe("https://prod.example.com");
    // 合法路径不留档
    expect(existsSync(`${filePath}.corrupt`)).toBe(false);
  });
});

describe("assertSecureTransport 畸形地址 fail-closed", () => {
  it("畸形 URL 加 token 场景直接抛解析错误而非放行", () => {
    let caught: any;
    try {
      assertSecureTransport("http://[::bad", "secret-token");
    } catch (err) {
      caught = err;
    }

    // 安全校验 fail-closed：无法解析目标时抛 INVALID_ARGUMENT，绝不静默放行
    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(ActionDockError);
    expect(caught.code).toBe(INVALID_ARGUMENT);
    expect(caught.message).toContain("Invalid server URL");
  });

  it("畸形 https 地址同样 fail-closed", () => {
    // normalizeServerUrl 对已带协议的地址不做重排，畸形保留至 URL 解析层
    expect(() => assertSecureTransport("https://[::bad", "secret-token")).toThrow(
      ActionDockError
    );
  });

  it("allowInsecureHttp 豁免不豁免地址合法性，畸形地址仍拒绝", () => {
    expect(() =>
      assertSecureTransport("http://[::bad", "secret-token", { allowInsecureHttp: true })
    ).toThrow(/Invalid server URL/);
  });

  it("无 token 时畸形地址不触发安全校验（保持既有放行语义）", () => {
    // 无凭据场景不属于传输安全职责，行为不变
    expect(() => assertSecureTransport("http://[::bad", undefined)).not.toThrow();
  });

  it("非回环明文 http 加 token 仍按 INSECURE_TRANSPORT 拒绝", () => {
    let caught: any;
    try {
      assertSecureTransport("http://remote.example.com:5177", "secret-token");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ActionDockError);
    expect(caught.code).toBe("INSECURE_TRANSPORT");
  });

  it("回环明文 http 加 token 放行（合法本地开发场景）", () => {
    expect(() => assertSecureTransport("http://127.0.0.1:5177", "secret-token")).not.toThrow();
    expect(() => assertSecureTransport("http://localhost:5177", "secret-token")).not.toThrow();
  });

  it("脱敏：错误信息不泄露携带凭据的完整地址", () => {
    let message = "";
    try {
      assertSecureTransport("http://user:pass@[::bad", "secret-token");
    } catch (err: any) {
      message = err.message;
    }
    expect(message).not.toContain("user:pass");
  });
});
