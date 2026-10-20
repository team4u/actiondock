# 参考手册：动作命名绑定与远端调用

当一个 Action 需要混合调用本地和远端依赖，或在同一次运行中分别调用同一动作的不同部署时，使用命名绑定。保持逻辑引用和 `uses` 不变，由调用方宿主解析执行位置；不要在业务代码中创建 HTTP 客户端或处理连接凭证。

## 先区分两类目标选择

- 整条 CLI 命令访问远端：使用 `ad run <pkg>/<action> --profile office`，或通过 `ad profile use office` 切换默认目标。
- Action 内部选择依赖执行位置：使用 `ctx.actions.invoke(ref, input, { binding: "primary" })`，并在调用方配置该绑定。
- 两者互不替代：`ad profile use` 不会重写内部依赖的显式绑定；CLI 指向远端后，内部依赖使用远端宿主自己的配置。
- 当前没有 `ad run --binding` 或 `ad link --profile` 用法。`binding` 是 SDK 调用选项，不是 Action 入参，也不是 `ad config set` 的配置项。

## 声明权限与配置位置

在调用方 Action 的清单条目中声明可调用的能力：

```json
{
  "uses": ["inventory/check", "pricing/quote"]
}
```

- `uses` 只声明逻辑权限，不填写地址、Profile 或绑定名。
- 当前宿主内的同包调用仍可豁免 `uses`；跨目标调用即使包名相同，也需要显式声明依赖，远端再独立鉴权。
- 纯远端依赖无需本地实现，也无需加入 `actiondock.json` 的 `dependencies`。需要本地备用实现时，仍要在调用方宿主安装或装载该实现。

在运行调用方 Action 的宿主上配置远端连接：

```bash
ad profile add office --server https://runner.example.com --token-env OFFICE_TOKEN
```

令牌由该宿主的环境变量提供，不写进 Action 源码、清单或绑定文件。

在调用方项目根目录创建 `.actiondock/bindings.json`：

```json
{
  "bindings": {
    "inventory/check": {
      "default": { "type": "local" }
    },
    "pricing/quote": {
      "primary": { "type": "remote", "profile": "office" },
      "fallback": { "type": "local" }
    }
  }
}
```

- 键必须是完全限定动作引用；命名绑定只匹配该引用，不使用通配符。
- `local` 仅接受 `type`；`remote` 仅接受 `type` 与 `profile`，不接受路径、URL 或令牌字段。
- 绑定名以字母或数字开头，后续可包含字母、数字、点号、下划线及横线；不得使用原型属性保留名。
- `primary`、`fallback` 只是业务名称，不隐含优先级、重试或故障切换。
- 文件属于调用方包，不是全局包路由表。同一引用在不同调用方包中可以绑定到不同目标。

## 混合调用与同名多目标调用

```ts
const inventory = await ctx.actions.invoke("inventory/check", input);

const primaryQuote = await ctx.actions.invoke("pricing/quote", input, {
  binding: "primary",
});

const fallbackQuote = await ctx.actions.invoke("pricing/quote", input, {
  binding: "fallback",
});
```

以上三个调用可以出现在同一次 Action 运行中。本地与远端都存在 `pricing/quote` 时，通过绑定选择目标，不改包名，不按发现顺序覆盖。

调用选项类型为 `ActionInvokeOptions`，其唯一可选字段是 `binding`。方法和可调用形式均支持第三参数：

```ts
await ctx.actions.invoke("pricing/quote", input, { binding: "primary" });
await ctx.actions("pricing/quote", input, { binding: "primary" });
```

- 未传 `binding`：仅查找该引用的 `default` 绑定；没有 `default` 就保持原有本地解析。
- 显式指定的绑定不存在：直接抛出 `NOT_FOUND`，不会回退到 `default`、本地或其他远端。
- 存在本地同名实现作为参照时：远端的 `inputSchema`、`outputSchema` 必须与本地深度一致，不一致时报 `INVALID_ARGUMENT`。契约一致不代表业务效果天然可互换。
- 没有本地参照时：由远端服务校验其动作契约，不下载实现源码。

## 编程式装配与配置快照

通过服务门面覆盖特定调用方包的文件配置：

```ts
import { createActionDock } from "@actiondock/core";

const dock = await createActionDock({
  projectRoot: "/srv/order-tools",
  actionBindings: {
    "order-tools": {
      "pricing/quote": {
        primary: { type: "remote", profile: "office" },
        fallback: { type: "local" },
      },
    },
  },
});

try {
  await dock.execution.run("order-tools/quote-order", { sku: "demo" });
} finally {
  await dock.close();
}
```

- `actionBindings` 最外层键是调用方包 ID；内层结构与文件中的 `bindings` 相同。传入配置整体覆盖该包的文件配置，不做逐项合并。
- 宿主装配时校验、复制并冻结绑定与 Profile 连接信息。修改文件、源对象或当前 Profile 不会改变已装配宿主的路由；配置调整后需要重新创建宿主。
- `local` 相对于当前执行宿主，不一定是发起 CLI 的电脑。
- 远端 Action 后续调用其他依赖时，使用远端自己的绑定，不继承发起端的整份路由配置。

## 显式降级与结果未知

仅在业务允许的情况下编写降级。以下片段仅适用于无副作用、且允许使用备用结果的报价查询：

```ts
try {
  return await ctx.actions.invoke("pricing/quote", input, {
    binding: "primary",
  });
} catch (error: any) {
  if (
    ctx.signal.aborted ||
    !["NETWORK_ERROR", "SERVICE_RESULT_UNKNOWN"].includes(error?.code)
  ) {
    throw error;
  }

  ctx.log.warn("主报价不可用，尝试本地备用报价", {
    code: error.code,
    remoteRunId: error.details?.remoteRunId,
  });
  return await ctx.actions.invoke("pricing/quote", input, {
    binding: "fallback",
  });
}
```

- 不要捕获所有错误后无条件降级。授权失败、契约不一致、绑定缺失和业务失败不默认属于可用性故障。
- 父任务取消或总超时预算耗尽后停止调用，不启动备用任务。
- 远端断链、超时或没有收到运行凭据，不代表远端未执行。扣款、写入、发消息等操作不能据此换端重跑。
- 每次远端子调用有独立的 `requestId`，不复用父任务标识。相同 `requestId` 在两个独立宿主上也不保证共享去重；写操作切换需要业务级幂等或结果核实。
- 取消会向已知远端运行发送协作请求；`requested` 只表示请求已发出，不表示远端已停止。清理失败或结果无法确认时，保留未知状态，不宣称取消成功。
- 不承诺跨宿主的完整调用栈、全局配额或分布式事务。

## 单元测试与多目标模拟验证

在单元测试中验证多目标绑定与显式降级逻辑时，使用 `@actiondock/testing` 提供的 `createTestRuntime`，通过 `runtime.actions.register` 注册不同绑定的模拟规则，无需配置真实的 Profile，无需网络连接，也无需下载远端依赖源码，详见 [testing.md](testing.md)。

- 显式绑定注册：分别注册同名引用的不同绑定规则，未传 `binding` 视为 `default`，具名绑定精确匹配，未命中具名绑定的调用直接阻断，绝不隐式回退到 `default` 或访问真实外部网络。
- 模拟可用性故障与降级断言：主绑定使用函数抛出指定的 `SERVICE_RESULT_UNKNOWN` 异常，备用绑定返回静态结果；调用方在捕获到指定错误且未被取消时平滑切至备用绑定。
- 调用历史与参数断言：通过 `runtime.actions.getCalls` 或 `runtime.actions.calls` 严格断言执行顺序、绑定名称与输入参数快照。
- 集成测试安全边界：单测模拟仅验证内存层面的调用编排与降级分支，不能证明实际的 HTTP 鉴权与取消协议可用，正式发布前仍需配合真实回环服务器进行集成测试。

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionDockError } from "@actiondock/core";
import { createTestRuntime } from "@actiondock/testing";

describe("多目标绑定降级验证", () => {
  it("主服务异常时降级至备用报价", async () => {
    const runtime = createTestRuntime({ packageId: "order-pkg" });

    // 针对 primary 绑定注册可用性异常
    runtime.actions.register(
      "pricing/quote",
      () => {
        throw new ActionDockError(
          "SERVICE_RESULT_UNKNOWN",
          "Primary pricing cluster temporarily unreachable"
        );
      },
      { binding: "primary" }
    );

    // 针对 fallback 绑定注册静态返回
    runtime.actions.register(
      "pricing/quote",
      { price: 99, currency: "USD" },
      { binding: "fallback" }
    );

    const caller = defineAction({
      uses: ["pricing/quote"],
      run: async (input: { sku: string }, ctx) => {
        try {
          return await ctx.actions.invoke(
            "pricing/quote",
            { sku: input.sku },
            { binding: "primary" }
          );
        } catch (error: any) {
          if (
            ctx.signal.aborted ||
            !["SERVICE_RESULT_UNKNOWN", "NETWORK_ERROR"].includes(error?.code)
          ) {
            throw error;
          }
          return await ctx.actions.invoke(
            "pricing/quote",
            { sku: input.sku },
            { binding: "fallback" }
          );
        }
      },
    });

    const result = await runtime.run(caller, { sku: "ITEM-1" });
    assert.deepStrictEqual(result, { price: 99, currency: "USD" });

    // 断言调用顺序与参数快照
    const calls = runtime.actions.calls;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].binding, "primary");
    assert.deepStrictEqual(calls[0].input, { sku: "ITEM-1" });
    assert.strictEqual(calls[1].binding, "fallback");
    assert.deepStrictEqual(calls[1].input, { sku: "ITEM-1" });
  });
});
```

## 出错后定位实际执行目标

仅在出现错误时，检查 `error.details` 中的 `action`、`binding`、`profile`、`requestId`、`remoteRunId`、`resultUnknown`，结合父运行事件中的远端关联日志定位；不要输出令牌或完整连接配置。

```bash
# 已取得远端运行标识时，在对应目标查看记录
ad runs show <remoteRunId> --profile office

# 未取得运行标识时，用本次子调用的 requestId 反查
ad runs list --request-id <requestId> --profile office
```

反查暂时没有记录也不能证明远端未执行。不同 Profile 可能指向不同宿主，不能直接用本地默认目标查询远端运行。

更多排查规则见 [troubleshooting.md](troubleshooting.md)，交付边界见 [build-and-export.md](build-and-export.md)。
