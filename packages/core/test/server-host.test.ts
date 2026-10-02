import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createActionDock } from "../src/service";
import { startActionDockServer } from "../src/server";

describe("startActionDockServer 支持 ActionDockService 绑定与生命周期自动协调", () => {
  it("传入 service 时暴露 server.service 并在 server.stop() 中自动协调 service.close()", async () => {
    const pingAction = defineAction({
      run: () => ({ pong: true }),
    });

    const service = await createActionDock({
      runtimeOptions: {
        projectConfig: {
          id: "pkg.server-service-app",
          name: "Server Service App",
          version: "1.0.0",
        },
        actions: [{ id: "ping", action: pingAction }],
        inMemory: true,
      },
    });

    // 验证 service 正常运行
    const preResult = await service.execution.run("pkg.server-service-app/ping", {});
    assert.strictEqual(preResult.ok, true);

    // 启动 HTTP 服务，绑定 service
    const serverInstance = await startActionDockServer({
      port: 0,
      service,
      token: "secret-test-token",
    });

    // 验证 serverInstance.service 正确暴露
    assert.strictEqual(serverInstance.service, service);
    assert.strictEqual(typeof serverInstance.port, "number");
    assert.ok((serverInstance.port) > 0);

    // 停止服务，验证自动协调 service.close()
    await serverInstance.stop();

    // 验证底层已经被自动关闭
    await assert.rejects(
      service.execution.run("pkg.server-service-app/ping", {})
    , /closed/);
  });
});

