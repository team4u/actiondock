import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import { createPackageRuntime } from "../src/package";
import { createActionDock } from "../src/service";
import { startActionDockServer } from "../src/server";

describe("startActionDockServer 支持 ActionDockService 绑定与生命周期自动协调", () => {
  it("传入 service 时暴露 server.service 并在 server.stop() 中自动协调 service.close()", async () => {
    const pingAction = defineAction({
      run: () => ({ pong: true }),
    });

    const app = await createPackageRuntime({
      projectConfig: {
        id: "pkg.server-service-app",
        name: "Server Service App",
        version: "1.0.0",
      },
      actions: [{ id: "ping", action: pingAction }],
      inMemory: true,
    });

    const service = await createActionDock({
      runtime: app,
    });

    // 验证 service 正常运行
    const preResult = await service.execution.run("pkg.server-service-app/ping", {});
    expect(preResult.ok).toBe(true);

    // 启动 HTTP 服务，绑定 service
    const serverInstance = await startActionDockServer({
      port: 0,
      service,
      token: "secret-test-token",
    });

    // 验证 serverInstance.service 正确暴露
    expect(serverInstance.service).toBe(service);
    expect(typeof serverInstance.port).toBe("number");
    expect(serverInstance.port).toBeGreaterThan(0);

    // 停止服务，验证自动协调 service.close()
    await serverInstance.stop();

    // 验证底层已经被自动关闭
    await expect(
      service.execution.run("pkg.server-service-app/ping", {})
    ).rejects.toThrow("closed");
  });
});

