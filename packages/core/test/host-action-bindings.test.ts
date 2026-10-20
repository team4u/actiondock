import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction, type ActionContext, type ExecutionEvent } from "@actiondock/sdk";
import { createActionDock } from "../src/service";
import { createActionDockHost, type ActionDockHost } from "../src/host";
import { startActionDockServer, type ActionDockServerInstance } from "../src/server";
import { addProfile, useProfile, removeProfile } from "../src/profile/manager";
import {
  ActionDockError,
  ACTION_CALL_CYCLE,
  ACTION_SUBRUN_LIMIT,
  NOT_FOUND,
  UNDECLARED_ACTION_DEPENDENCY,
} from "../src/errors";

interface TestContext {
  server?: ActionDockServerInstance;
  host?: ActionDockHost;
  tempHome?: string;
  tempPkgDir?: string;
}

async function cleanupContext(ctx: TestContext): Promise<void> {
  if (ctx.host) {
    try {
      await ctx.host.close();
    } catch {}
  }
  if (ctx.server) {
    try {
      await ctx.server.stop();
    } catch {}
  }
  if (ctx.tempHome && existsSync(ctx.tempHome)) {
    try {
      rmSync(ctx.tempHome, { recursive: true, force: true });
    } catch {}
  }
  if (ctx.tempPkgDir && existsSync(ctx.tempPkgDir)) {
    try {
      rmSync(ctx.tempPkgDir, { recursive: true, force: true });
    } catch {}
  }
}

describe("Host 端到端 Action 绑定与远端调用测试 (host-action-bindings)", () => {
  it("同一根 Action 依次调用同一完全限定引用本地 fallback 与 office primary，返回不同值证明双目标", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.math",
            name: "Remote Math Service",
            version: "1.0.0",
          },
          actions: [
            {
              id: "calc",
              action: defineAction({
                run: (input: { val: number }) => ({
                  result: input.val * 10,
                  target: "remote-office",
                }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "secret-office-token",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "secret-office-token",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.math",
              name: "Local Math Package",
              version: "1.0.0",
            },
            actions: {
              calc: defineAction({
                run: (input: { val: number }) => ({
                  result: input.val + 1,
                  target: "local-fallback",
                }),
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.caller",
              name: "Caller Package",
              version: "1.0.0",
            },
            actions: {
              "dual-call": defineAction({
                uses: ["pkg.math/calc"],
                run: async (input: { val: number }, actCtx: ActionContext) => {
                  const officeRes = await actCtx.actions.invoke<{ val: number }, { result: number; target: string }>(
                    "pkg.math/calc",
                    { val: input.val },
                    { binding: "office" }
                  );
                  const localRes = await actCtx.actions(
                    "pkg.math/calc",
                    { val: input.val },
                    { binding: "local" }
                  );
                  return { officeRes, localRes };
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.caller": {
            "pkg.math/calc": {
              local: { type: "local" },
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      const execResult = await ctx.host.execution.run("pkg.caller/dual-call", { val: 5 });
      assert.strictEqual(execResult.ok, true, JSON.stringify(execResult));
      assert.deepStrictEqual((execResult as any).data, {
        officeRes: { result: 50, target: "remote-office" },
        localRes: { result: 6, target: "local-fallback" },
      });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("支持本地 Action 与 remote-only Action 混合调用，远端依赖无需本地源码与 Runtime", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.cloud-only",
            name: "Cloud Only Package",
            version: "1.0.0",
          },
          actions: [
            {
              id: "query",
              action: defineAction({
                run: (input: { text: string }) => ({
                  echo: `remote:${input.text}`,
                  fromRemote: true,
                }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-cloud",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-cloud",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.local-only",
              name: "Local Service Package",
              version: "1.0.0",
            },
            actions: {
              ping: defineAction({
                run: () => ({ pong: true, fromLocal: true }),
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.client",
              name: "Mixed Client Package",
              version: "1.0.0",
            },
            actions: {
              orchestrate: defineAction({
                uses: ["pkg.local-only/ping", "pkg.cloud-only/query"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  const local = await actCtx.actions.invoke("pkg.local-only/ping", {});
                  const remote = await actCtx.actions.invoke(
                    "pkg.cloud-only/query",
                    { text: "hello" },
                    { binding: "office" }
                  );
                  return { local, remote };
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.client": {
            "pkg.cloud-only/query": {
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      assert.strictEqual(ctx.host.getRuntime("pkg.cloud-only"), undefined);

      const execResult = await ctx.host.execution.run("pkg.client/orchestrate", {});
      assert.strictEqual(execResult.ok, true);
      assert.deepStrictEqual((execResult as any).data, {
        local: { pong: true, fromLocal: true },
        remote: { echo: "remote:hello", fromRemote: true },
      });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("省略 binding 旧调用保持本地执行；default 显式 remote 配置生效", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.service",
            name: "Remote Target Service",
            version: "1.0.0",
          },
          actions: [
            {
              id: "identify",
              action: defineAction({
                run: () => ({ location: "remote-cluster" }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-identify",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-identify",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.service",
              name: "Local Service Package",
              version: "1.0.0",
            },
            actions: {
              identify: defineAction({
                run: () => ({ location: "local-node" }),
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.caller-no-default",
              name: "Caller Without Default",
              version: "1.0.0",
            },
            actions: {
              call: defineAction({
                uses: ["pkg.service/identify"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.service/identify", {});
                },
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.caller-with-remote-default",
              name: "Caller With Remote Default",
              version: "1.0.0",
            },
            actions: {
              call: defineAction({
                uses: ["pkg.service/identify"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.service/identify", {});
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.caller-no-default": {
            "pkg.service/identify": {
              office: { type: "remote", profile: "office" },
            },
          },
          "pkg.caller-with-remote-default": {
            "pkg.service/identify": {
              default: { type: "remote", profile: "office" },
              fallback: { type: "local" },
            },
          },
        },
      });

      const resNoDefault = await ctx.host.execution.run("pkg.caller-no-default/call", {});
      assert.strictEqual(resNoDefault.ok, true);
      assert.deepStrictEqual((resNoDefault as any).data, { location: "local-node" });

      const resRemoteDefault = await ctx.host.execution.run("pkg.caller-with-remote-default/call", {});
      assert.strictEqual(resRemoteDefault.ok, true);
      assert.deepStrictEqual((resRemoteDefault as any).data, { location: "remote-cluster" });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("显式请求 missing binding 时直接抛出 NOT_FOUND，不发生自动回退", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.target",
              name: "Target Package",
              version: "1.0.0",
            },
            actions: {
              greet: defineAction({
                run: () => ({ message: "local greet" }),
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.caller",
              name: "Caller Package",
              version: "1.0.0",
            },
            actions: {
              testMissing: defineAction({
                uses: ["pkg.target/greet"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke(
                    "pkg.target/greet",
                    {},
                    { binding: "non-existent-binding" }
                  );
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.caller": {
            "pkg.target/greet": {
              default: { type: "local" },
            },
          },
        },
      });

      const res = await ctx.host.execution.run("pkg.caller/testMissing", {});
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error.code, NOT_FOUND);
      assert.deepStrictEqual(res.error.details, {
        action: "pkg.target/greet",
        binding: "non-existent-binding",
      });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("uses 未声明（含跨包及同包远端调用）在执行前均被严格拒绝，同包短名声明正常放行", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.app",
            name: "Remote App Package",
            version: "1.0.0",
          },
          actions: [
            {
              id: "worker",
              action: defineAction({
                run: () => ({ remoteDone: true }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-uses",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-uses",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.target",
              name: "External Target",
              version: "1.0.0",
            },
            actions: {
              act: defineAction({
                run: () => ({ done: true }),
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.app",
              name: "Application Package",
              version: "1.0.0",
            },
            actions: {
              "unauth-cross": defineAction({
                uses: [],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke(
                    "pkg.target/act",
                    {},
                    { binding: "office" }
                  );
                },
              }),
              "unauth-same-remote": defineAction({
                uses: [],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke(
                    "pkg.app/worker",
                    {},
                    { binding: "office" }
                  );
                },
              }),
              "auth-same-remote-short": defineAction({
                uses: ["worker"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke(
                    "pkg.app/worker",
                    {},
                    { binding: "office" }
                  );
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.app": {
            "pkg.target/act": {
              office: { type: "remote", profile: "office" },
            },
            "pkg.app/worker": {
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      const resCross = await ctx.host.execution.run("pkg.app/unauth-cross", {});
      assert.strictEqual(resCross.ok, false);
      assert.strictEqual(resCross.error.code, UNDECLARED_ACTION_DEPENDENCY);

      const resSameUndeclared = await ctx.host.execution.run("pkg.app/unauth-same-remote", {});
      assert.strictEqual(resSameUndeclared.ok, false);
      assert.strictEqual(resSameUndeclared.error.code, UNDECLARED_ACTION_DEPENDENCY);

      const resSameShort = await ctx.host.execution.run("pkg.app/auth-same-remote-short", {});
      assert.strictEqual(resSameShort.ok, true);
      assert.deepStrictEqual((resSameShort as any).data, { remoteDone: true });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("不同调用方对同一目标 Action 完全限定引用绑定配置严格隔离", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.shared",
            name: "Remote Shared Service",
            version: "1.0.0",
          },
          actions: [
            {
              id: "execute",
              action: defineAction({
                run: () => ({ routedTo: "remote-cluster" }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-shared",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-shared",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.shared",
              name: "Local Shared Service",
              version: "1.0.0",
            },
            actions: {
              execute: defineAction({
                run: () => ({ routedTo: "local-instance" }),
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.client-a",
              name: "Client A",
              version: "1.0.0",
            },
            actions: {
              runAction: defineAction({
                uses: ["pkg.shared/execute"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.shared/execute", {});
                },
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.client-b",
              name: "Client B",
              version: "1.0.0",
            },
            actions: {
              runAction: defineAction({
                uses: ["pkg.shared/execute"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.shared/execute", {});
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.client-a": {
            "pkg.shared/execute": {
              default: { type: "remote", profile: "office" },
            },
          },
          "pkg.client-b": {
            "pkg.shared/execute": {
              default: { type: "local" },
            },
          },
        },
      });

      const resA = await ctx.host.execution.run("pkg.client-a/runAction", {});
      assert.strictEqual(resA.ok, true);
      assert.deepStrictEqual((resA as any).data, { routedTo: "remote-cluster" });

      const resB = await ctx.host.execution.run("pkg.client-b/runAction", {});
      assert.strictEqual(resB.ok, true);
      assert.deepStrictEqual((resB as any).data, { routedTo: "local-instance" });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("支持从 packageRoot/.actiondock/bindings.json 加载文件绑定并在修改后保持初始快照，且 API 配置优先覆盖文件", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));
      ctx.tempPkgDir = mkdtempSync(join(tmpdir(), "ad-host-bindings-pkg-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.remote-svc",
            name: "Remote Target",
            version: "1.0.0",
          },
          actions: [
            {
              id: "action",
              action: defineAction({
                run: () => ({ executedAt: "remote-office" }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-file-test",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-file-test",
        },
        ctx.tempHome
      );

      const bindingsDir = join(ctx.tempPkgDir, ".actiondock");
      mkdirSync(bindingsDir, { recursive: true });
      const bindingsFilePath = join(bindingsDir, "bindings.json");
      writeFileSync(
        bindingsFilePath,
        JSON.stringify({
          bindings: {
            "pkg.remote-svc/action": {
              default: { type: "remote", profile: "office" },
            },
          },
        }),
        "utf-8"
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            packageRoot: ctx.tempPkgDir,
            projectConfig: {
              id: "pkg.file-caller",
              name: "File Configured Caller",
              version: "1.0.0",
            },
            actions: {
              runCall: defineAction({
                uses: ["pkg.remote-svc/action"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.remote-svc/action", {});
                },
              }),
            },
            inMemory: true,
          },
          {
            packageRoot: ctx.tempPkgDir,
            projectConfig: {
              id: "pkg.api-override-caller",
              name: "API Override Caller",
              version: "1.0.0",
            },
            actions: {
              runCall: defineAction({
                uses: ["pkg.remote-svc/action"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.remote-svc/action", {});
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.api-override-caller": {
            "pkg.remote-svc/action": {
              default: { type: "local" },
            },
          },
        },
      });

      writeFileSync(bindingsFilePath, JSON.stringify({ bindings: {} }), "utf-8");

      const resFile = await ctx.host.execution.run("pkg.file-caller/runCall", {});
      assert.strictEqual(resFile.ok, true);
      assert.deepStrictEqual((resFile as any).data, { executedAt: "remote-office" });

      const resApiOverride = await ctx.host.execution.run("pkg.api-override-caller/runCall", {});
      assert.strictEqual(resApiOverride.ok, false);
      assert.strictEqual(resApiOverride.error.code, "PACKAGE_NOT_FOUND");
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("API 配置对象在 Host 初始化及调用后被外部修改，运行时快照不受任何影响", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.target-immut",
            name: "Immut Target",
            version: "1.0.0",
          },
          actions: [
            {
              id: "serve",
              action: defineAction({
                run: () => ({ immutOk: true }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-immut",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-immut",
        },
        ctx.tempHome
      );

      const targetBinding = { type: "remote" as const, profile: "office" };
      const groupBinding = { default: targetBinding };
      const actionGroup = { "pkg.target-immut/serve": groupBinding };
      const mutableBindings = {
        "pkg.mut-caller": actionGroup,
      };

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.mut-caller",
              name: "Mutable Caller",
              version: "1.0.0",
            },
            actions: {
              call: defineAction({
                uses: ["pkg.target-immut/serve"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.target-immut/serve", {});
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: mutableBindings,
      });

      (targetBinding as any).profile = "tampered-profile";
      (groupBinding as any).default = { type: "local" };
      (actionGroup as any)["pkg.target-immut/serve"] = {};
      delete (mutableBindings as any)["pkg.mut-caller"];

      const res = await ctx.host.execution.run("pkg.mut-caller/call", {});
      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual((res as any).data, { immutOk: true });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("业务代码显式 catch 特定远端错误后 fallback 本地成功，非框架自动回退", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.flaky",
            name: "Remote Flaky Service",
            version: "1.0.0",
          },
          actions: [
            {
              id: "operate",
              action: defineAction({
                run: () => {
                  throw new ActionDockError(
                    "REMOTE_TEMP_DOWN" as any,
                    "Remote subsystem temporarily down"
                  );
                },
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-flaky",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-flaky",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.flaky",
              name: "Local Flaky Service",
              version: "1.0.0",
            },
            actions: {
              operate: defineAction({
                run: () => ({ status: "local-fallback-success" }),
              }),
            },
            inMemory: true,
          },
          {
            projectConfig: {
              id: "pkg.resilient-client",
              name: "Resilient Client",
              version: "1.0.0",
            },
            actions: {
              execute: defineAction({
                uses: ["pkg.flaky/operate"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  let caughtErrorCode = "";
                  let output: any;
                  try {
                    output = await actCtx.actions.invoke(
                      "pkg.flaky/operate",
                      {},
                      { binding: "office" }
                    );
                  } catch (err: any) {
                    if (err instanceof ActionDockError && String(err.code) === "REMOTE_TEMP_DOWN") {
                      caughtErrorCode = err.code;
                      output = await actCtx.actions.invoke(
                        "pkg.flaky/operate",
                        {},
                        { binding: "local" }
                      );
                    } else {
                      throw err;
                    }
                  }
                  return { output, caughtErrorCode };
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.resilient-client": {
            "pkg.flaky/operate": {
              local: { type: "local" },
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      const res = await ctx.host.execution.run("pkg.resilient-client/execute", {});
      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual((res as any).data, {
        output: { status: "local-fallback-success" },
        caughtErrorCode: "REMOTE_TEMP_DOWN",
      });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("远端调用受 maxSubRuns 配额约束并在调用结束后及时释放槽位", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.quota-remote",
            name: "Quota Remote",
            version: "1.0.0",
          },
          actions: [
            {
              id: "slow-task",
              action: defineAction({
                run: async (input: { durationMs: number }) => {
                  if (input.durationMs > 0) {
                    await new Promise((r) => setTimeout(r, input.durationMs));
                  }
                  return { finished: true, ms: input.durationMs };
                },
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-quota",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-quota",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        maxSubRuns: 1,
        packages: [
          {
            projectConfig: {
              id: "pkg.quota-caller",
              name: "Quota Caller",
              version: "1.0.0",
            },
            actions: {
              testQuota: defineAction({
                uses: ["pkg.quota-remote/slow-task"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  const firstInvocationPromise = actCtx.actions.invoke(
                    "pkg.quota-remote/slow-task",
                    { durationMs: 40 },
                    { binding: "office" }
                  );

                  let secondRejectedCode = "";
                  try {
                    await actCtx.actions.invoke(
                      "pkg.quota-remote/slow-task",
                      { durationMs: 5 },
                      { binding: "office" }
                    );
                  } catch (err: any) {
                    if (err instanceof ActionDockError) {
                      secondRejectedCode = err.code;
                    }
                  }

                  const firstResult = await firstInvocationPromise;

                  const thirdResult = await actCtx.actions.invoke(
                    "pkg.quota-remote/slow-task",
                    { durationMs: 0 },
                    { binding: "office" }
                  );

                  return {
                    firstResult,
                    secondRejectedCode,
                    thirdResult,
                  };
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.quota-caller": {
            "pkg.quota-remote/slow-task": {
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      const res = await ctx.host.execution.run("pkg.quota-caller/testQuota", {});
      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual((res as any).data, {
        firstResult: { finished: true, ms: 40 },
        secondRejectedCode: ACTION_SUBRUN_LIMIT,
        thirdResult: { finished: true, ms: 0 },
      });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("命名远端调用不应假报本地同名 Action 环路死锁", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.recursive",
            name: "Recursive Remote",
            version: "1.0.0",
          },
          actions: [
            {
              id: "step",
              action: defineAction({
                run: (input: { depth: number }) => ({
                  executedOnRemote: true,
                  depth: input.depth,
                }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-recursive",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-recursive",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.recursive",
              name: "Recursive Local",
              version: "1.0.0",
            },
            actions: {
              step: defineAction({
                uses: ["step"],
                run: async (input: { depth: number; target: "local" | "remote" }, actCtx: ActionContext) => {
                  if (input.target === "remote") {
                    return await actCtx.actions.invoke(
                      "pkg.recursive/step",
                      { depth: input.depth + 1 },
                      { binding: "office" }
                    );
                  }
                  return await actCtx.actions.invoke(
                    "pkg.recursive/step",
                    { depth: input.depth + 1 },
                    { binding: "local" }
                  );
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.recursive": {
            "pkg.recursive/step": {
              local: { type: "local" },
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      const remoteRes = await ctx.host.execution.run("pkg.recursive/step", { depth: 0, target: "remote" });
      assert.strictEqual(remoteRes.ok, true);
      assert.deepStrictEqual((remoteRes as any).data, { executedOnRemote: true, depth: 1 });

      const localRes = await ctx.host.execution.run("pkg.recursive/step", { depth: 0, target: "local" });
      assert.strictEqual(localRes.ok, false);
      assert.strictEqual(localRes.error.code, ACTION_CALL_CYCLE);
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("profile 由 Host 初始化时从 customHome 读取并冻结连接信息，不跟随后续 profile use 或 remove 变动", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.profile-target",
            name: "Profile Target",
            version: "1.0.0",
          },
          actions: [
            {
              id: "ping",
              action: defineAction({
                run: () => ({ profileConn: "stable" }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-profile-test",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-profile-test",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.profile-caller",
              name: "Profile Caller",
              version: "1.0.0",
            },
            actions: {
              testCall: defineAction({
                uses: ["pkg.profile-target/ping"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.profile-target/ping", {}, { binding: "office" });
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.profile-caller": {
            "pkg.profile-target/ping": {
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      useProfile("local", ctx.tempHome);
      removeProfile("office", ctx.tempHome);

      const res = await ctx.host.execution.run("pkg.profile-caller/testCall", {});
      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual((res as any).data, { profileConn: "stable" });
    } finally {
      await cleanupContext(ctx);
    }
  });

  it("远端执行成功后可从父运行事件日志查到 remoteRunId 关联", async () => {
    const ctx: TestContext = {};
    try {
      ctx.tempHome = mkdtempSync(join(tmpdir(), "ad-host-bindings-home-"));

      const remoteService = await createActionDock({
        runtimeOptions: {
          projectConfig: {
            id: "pkg.audit-target",
            name: "Audit Target",
            version: "1.0.0",
          },
          actions: [
            {
              id: "work",
              action: defineAction({
                run: () => ({ auditSuccess: true }),
              }),
            },
          ],
          inMemory: true,
        },
      });

      ctx.server = await startActionDockServer({
        port: 0,
        hostname: "127.0.0.1",
        token: "token-audit",
        service: remoteService,
        enableManagement: false,
      });

      addProfile(
        "office",
        {
          serverUrl: ctx.server.url,
          token: "token-audit",
        },
        ctx.tempHome
      );

      ctx.host = await createActionDockHost({
        customHome: ctx.tempHome,
        autoLoadCurrentProject: false,
        inMemory: true,
        packages: [
          {
            projectConfig: {
              id: "pkg.audit-caller",
              name: "Audit Caller",
              version: "1.0.0",
            },
            actions: {
              runAudit: defineAction({
                uses: ["pkg.audit-target/work"],
                run: async (_input: unknown, actCtx: ActionContext) => {
                  return await actCtx.actions.invoke("pkg.audit-target/work", {}, { binding: "office" });
                },
              }),
            },
            inMemory: true,
          },
        ],
        actionBindings: {
          "pkg.audit-caller": {
            "pkg.audit-target/work": {
              office: { type: "remote", profile: "office" },
            },
          },
        },
      });

      const ticket = await ctx.host.execution.start("pkg.audit-caller/runAudit", {});
      assert.ok(ticket.runId);

      const events: ExecutionEvent[] = [];
      const eventSubscription = (async () => {
        try {
          for await (const evt of ctx.host!.events(ticket.runId)) {
            events.push(evt);
            if (evt.type === "finish") {
              break;
            }
          }
        } catch {}
      })();

      const execResult = await ticket.result!;
      await eventSubscription;

      assert.strictEqual(execResult.ok, true);

      const logEvents = events.filter((e) => e.type === "log");
      const hasRemoteRunIdLog = logEvents.some(
        (e) => typeof (e as any).message === "string" && (e as any).message.includes("remoteRunId=")
      );

      assert.strictEqual(
        hasRemoteRunIdLog,
        true,
        `Parent run event stream must contain a log entry with 'remoteRunId='. Captured logs: ${JSON.stringify(
          logEvents
        )}`
      );
    } finally {
      await cleanupContext(ctx);
    }
  });
});
