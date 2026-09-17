import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProfile,
  getProfile,
  loadProfiles,
  resolveTarget,
  updateProfile,
} from "@actiondock/core";
import { Command } from "commander";
import { registerProfileCommands } from "../src/commands/profile";
import { withTarget, withRemoteTarget } from "../src/utils/target";

describe("Profile Insecure TLS Integration", () => {
  const tempHome = mkdtempSync(join(tmpdir(), "actiondock-profile-tls-test-"));

  afterAll(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("addProfile 支持保存 insecure: true 字段至 profiles.json", () => {
    addProfile(
      "remote-insecure",
      {
        serverUrl: "https://10.0.0.1:5177",
        token: "tok-123",
        insecure: true,
      },
      tempHome
    );

    const entry = getProfile("remote-insecure", tempHome);
    expect(entry).toBeDefined();
    expect(entry?.serverUrl).toBe("https://10.0.0.1:5177");
    expect(entry?.insecure).toBe(true);
  });

  it("updateProfile 支持更新已有 Profile 的 insecure 配置", () => {
    updateProfile(
      "remote-insecure",
      {
        insecure: false,
      },
      tempHome
    );

    const entry = getProfile("remote-insecure", tempHome);
    expect(entry?.insecure).toBe(false);

    updateProfile(
      "remote-insecure",
      {
        insecure: true,
      },
      tempHome
    );
    expect(getProfile("remote-insecure", tempHome)?.insecure).toBe(true);
  });

  it("resolveTarget 正确继承 Profile 中的 insecure 配置并支持选项覆盖", () => {
    const resolved = resolveTarget({ profile: "remote-insecure" }, tempHome);
    expect(resolved.type).toBe("remote");
    expect(resolved.insecure).toBe(true);

    const overridden = resolveTarget({ profile: "remote-insecure", insecure: false }, tempHome);
    expect(overridden.insecure).toBe(false);
  });

  it("resolveTarget 支持通过 ACTIONDOCK_INSECURE 环境变量全局启用 insecure", () => {
    const prev = process.env.ACTIONDOCK_INSECURE;
    try {
      process.env.ACTIONDOCK_INSECURE = "true";
      const resolved = resolveTarget({ server: "https://example.internal:5177" }, tempHome);
      expect(resolved.insecure).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.ACTIONDOCK_INSECURE;
      } else {
        process.env.ACTIONDOCK_INSECURE = prev;
      }
    }
  });

  it("CLI 命令 ad profile add -k 与 ad profile update --no-insecure 能正确挂载并执行", async () => {
    // 临时切换 ACTIONDOCK_HOME 供 CLI 读取
    const prevHome = process.env.ACTIONDOCK_HOME;
    process.env.ACTIONDOCK_HOME = tempHome;

    try {
      const program = new Command();
      registerProfileCommands(program);

      // 执行 ad profile add prod-node -s https://prod:5177 -k
      await program.parseAsync(["node", "ad", "profile", "add", "prod-node", "-s", "https://prod:5177", "-k"]);
      const added = getProfile("prod-node", tempHome);
      expect(added).toBeDefined();
      expect(added?.insecure).toBe(true);

      // 执行 ad profile update prod-node --no-insecure
      const programUpdate = new Command();
      registerProfileCommands(programUpdate);
      await programUpdate.parseAsync(["node", "ad", "profile", "update", "prod-node", "--no-insecure"]);
      const updated = getProfile("prod-node", tempHome);
      expect(updated?.insecure).toBe(false);
    } finally {
      if (prevHome === undefined) {
        delete process.env.ACTIONDOCK_HOME;
      } else {
        process.env.ACTIONDOCK_HOME = prevHome;
      }
    }
  });

  it("withTarget 与 withRemoteTarget 正确将 insecure 与 allowInsecureHttp 透传至 resolveTarget", async () => {
    let capturedResolvedTarget: any;
    let capturedTarget: any;

    await withTarget(
      {
        server: "http://127.0.0.1:5177",
        insecure: true,
        allowInsecureHttp: true,
      },
      { customHome: tempHome } as any,
      async (target, resolved) => {
        capturedResolvedTarget = resolved;
        capturedTarget = target;
      }
    );

    expect(capturedResolvedTarget.insecure).toBe(true);
    expect(capturedResolvedTarget.allowInsecureHttp).toBe(true);
    expect(capturedTarget.insecure).toBe(true);
    expect(capturedTarget.allowInsecureHttp).toBe(true);

    let capturedRemoteResolvedTarget: any;
    let capturedRemoteTarget: any;

    await withRemoteTarget(
      {
        server: "https://127.0.0.1:5177",
        insecure: true,
        allowInsecureHttp: true,
      },
      { customHome: tempHome } as any,
      async (target, resolved) => {
        capturedRemoteResolvedTarget = resolved;
        capturedRemoteTarget = target;
      }
    );

    expect(capturedRemoteResolvedTarget.insecure).toBe(true);
    expect(capturedRemoteResolvedTarget.allowInsecureHttp).toBe(true);
    expect(capturedRemoteTarget.insecure).toBe(true);
    expect(capturedRemoteTarget.allowInsecureHttp).toBe(true);
  });
});
