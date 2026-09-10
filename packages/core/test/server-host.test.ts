import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import { startActionDockServer } from "../src/server";

describe("startActionDockServer 扩展支持 ActionDockHost 绑定与生命周期自动协调", () => {
  it("传入 host 时暴露 server.host 并在 server.stop() 中自动协调 host.close()", async () => {
    const pingAction = defineAction({
      run: () => ({ pong: true }),
    });

    const app = await createActionDockApp({
      projectConfig: {
        id: "pkg.server-host-app",
        name: "Server Host App",
        version: "1.0.0",
      },
      actions: [{ id: "ping", action: pingAction }],
      inMemory: true,
    });

    const host = await createActionDockHost({
      packages: [app],
      autoLoadCurrentProject: false,
      inMemory: true,
    });

    // 验证 host 正常运行
    const preResult = await host.runAction("pkg.server-host-app/ping", {});
    expect(preResult.ok).toBe(true);

    // 启动 HTTP 服务，绑定 host
    const serverInstance = await startActionDockServer({
      port: 0,
      host,
      token: "secret-test-token",
    });

    // 验证 serverInstance.host 正确暴露 ActionDockHost
    expect(serverInstance.host).toBe(host);
    expect(typeof serverInstance.port).toBe("number");
    expect(serverInstance.port).toBeGreaterThan(0);

    // 停止服务，验证自动协调 host.close()
    await serverInstance.stop();

    // 验证 host 已经被自动关闭
    await expect(
      host.runAction("pkg.server-host-app/ping", {})
    ).rejects.toThrow("ActionDockHost is closed: new tasks rejected");
  });
});
