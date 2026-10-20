# 动作命名绑定与路由机制

在分布式与多环境部署架构中，Action 的调用方往往需要面对不同的执行拓扑。例如在开发态调用本地轻量逻辑，在生产态调度至高性能远端计算节点，或者在主节点故障时执行本地降级。

ActionDock 提供了动作命名绑定机制，允许开发者在保持业务代码中逻辑动作标识不变的前提下，通过外部配置文件或编程式配置将动作调用动态映射至本地或远端执行节点。

---

## 核心设计定位

- 逻辑引用与物理拓扑解耦：业务源码中使用完全限定的动作标识（如 `pricing/quote`），代码无需感知目标 Action 是在当前进程本地执行，还是通过网络分发至远端宿主。
- 单一事实源权限保护：清单文件 `actiondock.json` 中的 `uses` 权限声明始终保持逻辑动作标识，不随部署环境或运行时拓扑的变动而改变。
- 业务显式掌控降级：框架提供多目标命名路由能力，但绝不执行未经业务授权的自动重试或隐式回退；所有主备切换均由业务代码显式决策。

---

## 配置文件规范

动作命名绑定在调用方项目根目录下的 `.actiondock/bindings.json` 文件中进行声明。

### 配置文件结构

```json
{
  "bindings": {
    "pricing/quote": {
      "primary": {
        "type": "remote",
        "profile": "office"
      },
      "fallback": {
        "type": "local"
      },
      "default": {
        "type": "local"
      }
    }
  }
}
```

- 顶层字段 `bindings`：以完全限定动作引用（`<package-id>/<action-id>`）为键名的字典。
- 命名绑定标识：动作字典下的子键名，由字母、数字、点号、下划线及横线组成（如 `primary`、`fallback`、`default`）。
- 绑定目标类型 `type`：
  - `local`：表示在当前执行宿主进程内寻址并执行，该目标不接受任何额外参数。
  - `remote`：表示通过远端服务调度执行，必须提供 `profile` 字段指定已配置的环境标识。

---

## 路由解析与查找规则

当 Action 内部通过 `ctx.actions` 发起调用时，底层宿主根据以下规则完成绑定解析：

- 未传绑定参数：若调用时未传入 `binding` 选项，系统仅在绑定配置中检索 `default` 条目；若配置中未声明 `default` 绑定，系统自动保持当前宿主的默认本地解析逻辑。
- 显式指定绑定参数：若调用时显式传入了 `binding`（例如 `{ binding: "primary" }`），但该动作在绑定字典中不存在该命名条目，系统立即抛出 `NOT_FOUND` 错误，严禁隐式回退至 `default` 或本地目标。
- 目标合法性校验：完全限定引用格式必须严格符合规范，严禁使用冒号历史语法、通配符、路径穿透字符或空白字符。

---

## SDK 调用契约与接口签名

业务 Action 可以通过方法调用或直接函数调用的形式指定命名绑定。

### 接口定义

```ts
export interface ActionInvokeOptions {
  /** 显式指定的路由绑定标识（若不指定则遵循默认绑定策略） */
  binding?: string;
}

export interface ActionInvoker {
  /** 可调用函数形式，通过第三个参数指定选项 */
  (
    ref: string | ActionRef,
    input?: unknown,
    options?: ActionInvokeOptions
  ): Promise<unknown>;

  /** 显式调用方法，通过第三个参数指定选项 */
  invoke<I = unknown, O = unknown>(
    action: ActionRef | string,
    input?: I,
    options?: ActionInvokeOptions
  ): Promise<O>;
}
```

### 基础调用语法

- 通过方法形式指定主绑定：
  ```ts
  const quote = await ctx.actions.invoke("pricing/quote", input, {
    binding: "primary",
  });
  ```

- 通过可调用函数形式指定主绑定：
  ```ts
  const quote = await ctx.actions("pricing/quote", input, {
    binding: "primary",
  });
  ```

---

## 编程式覆盖配置

在自动化测试、集成测试或动态宿主装配场景下，可以通过 `createActionDock` 的启动选项在内存中覆盖指定调用方包的文件配置。

```ts
import { createActionDock } from "@actiondock/core";

const dock = await createActionDock({
  actionBindings: {
    "my-caller-pkg": {
      "pricing/quote": {
        primary: { type: "remote", profile: "office" },
        fallback: { type: "local" },
        default: { type: "local" },
      },
    },
  },
});
```

- 该配置以调用方包标识（`callerPackageId`）为键。
- 传入的命名绑定字典在服务启动时进行严格模式校验，直接生效并覆盖磁盘上的 `.actiondock/bindings.json`。

---

## 权限声明与依赖边界

- 权限声明保持逻辑标识：调用方包的清单文件 `actiondock.json` 中，`uses` 数组保持声明逻辑标识（例如 `["pricing/quote"]`）。
- 跨目标显式鉴权要求：即使目标 Action 声明的包名与当前调用方相同，只要路由至跨节点或远端目标，清单中也必须显式声明 `uses`，且远端宿主将执行独立的权限鉴权与令牌校验。
- 远端实现源码要求：对于仅路由至远端执行的 Action，本地项目无需包含其实现源码，也不需要加入 `actiondock.json` 的 `dependencies`。若另需本地备用实现，仍可正常安装本地依赖。
- 校验与构建联动：清单中的 `uses` 声明结合 `.actiondock/bindings.json` 中的远端绑定目标，使 `ad validate` 与 `ad build` 能够正确识别外部跨节点依赖，避免因本地缺少动作源码而报错。

---

## 契约参照与模式一致性

- 存在本地同名参照时：当本地动作目录中同时存在与目标完全限定标识相同的 Action 时，本地定义的输入模式（`inputSchema`）与输出模式（`outputSchema`）将作为契约基准。远端节点所公布的模式必须与本地模式保持深度严格一致（`isDeepStrictEqual`）；若检测到契约不一致，系统立即抛出 `INVALID_ARGUMENT` 错误阻断执行，防止脏数据穿透。
- 无本地参照时：当本地不存在对应动作源码时，系统完全依照远端节点实际公布的元数据契约执行校验与分发。

---

## 宿主装配与生命周期约束

- 装配时连接快照：动作绑定配置与 Profile 远程目标连接在宿主初始化装配时统一解析并完成冻结快照，服务运行期间不会动态重载配置文件。
- 宿主解析位置语义：Profile 解析始终发生在运行当前 Action 的宿主环境上；配置中的 `type: "local"` 代表执行该动作的宿主本身，绝非发起 CLI 调用的客户端电脑。
- 远端后续依赖隔离：远端 Action 内部如果触发了下游动作级联调用，其后续依赖将完全依托远端宿主所在的环境与配置规则进行解析，不反向依赖发起端。

---

## 构建产物与部署隔离

- 凭据与绑定不入包：执行 `ad build` 或 `ad pack` 导出产物时，框架不会将开发机本地的 `.actiondock/bindings.json` 或含有连接密钥的 `profiles.json` 复制到构建产物中。
- 目标环境独立配置：交付产物部署至生产节点或目标宿主后，运行环境需要根据现场拓扑重新配置对应的 Profile 连接与动作绑定文件。

---

## 显式业务降级实践

同一完全限定动作配置多个命名绑定支持业务实现主备容灾切换。框架层坚持确定性原则，不提供静默的自动重试与隐式回退机制。

### 降级核心原则

- 严禁盲目拦截所有异常：降级逻辑必须审慎辨别错误类型，严禁对捕获的所有异常一概执行降级。
- 父任务取消严禁降级：若父级任务已收到中止信号（`ctx.signal.aborted` 为真）或抛出取消错误（错误码 `ACTION_CANCELLED`），说明上游已主动终止或超时，此时必须立即向上透传抛出，严禁执行降级分支消耗额外资源。
- 仅在明确允许的故障场景降级：以下示例仅适用于无副作用且允许使用备用结果的报价计算。写操作即使发生网络断链，也不能据此认定远端未执行，必须先确认结果或具备跨目标的业务幂等机制。

### 完整降级示例代码

以下代码演示了主远端报价失败时安全降级至本地备用规则的完整实现：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction(async (input, ctx) => {
  try {
    // 优先调用远端高精算力服务
    return await ctx.actions.invoke("pricing/quote", input, {
      binding: "primary",
    });
  } catch (error: any) {
    // 铁律：若父级任务已取消或已超时，严禁降级，必须立即向上透传
    if (ctx.signal.aborted || error?.code === "ACTION_CANCELLED") {
      throw error;
    }

    // 仅对只读报价中明确允许的可用性故障降级，其他错误原样透传
    if (!["NETWORK_ERROR", "SERVICE_RESULT_UNKNOWN"].includes(error?.code)) {
      throw error;
    }

    // 记录诊断日志至标准错误流
    ctx.log.warn("远端报价主服务调用失败，触发本地备用规则计算", {
      reason: error?.message,
      code: error?.code,
    });

    // 显式调用本地备用绑定进行降级
    return await ctx.actions.invoke("pricing/quote", input, {
      binding: "fallback",
    });
  }
});
```

---

## 架构透明度与边界约束

ActionDock 保持分布式系统边界的完全透明，不夸大跨网络透明性：

- 取消协作的不可靠边界：跨服务取消属于协作式通知。若在取消过程中遭遇网络断链或超时，远端任务是否真正停止可能无法确认，系统将抛出 `SERVICE_RESULT_UNKNOWN` 错误，业务层须做好幂等准备。
- 请求标识作用域：每次远端子调用生成独立的 `requestId`，用于反查和关联远端运行，不复用父任务请求标识，也不承诺跨独立服务的全局去重。
- 调用栈与配额边界：跨远端服务调用不提供跨网络的完整内联调用栈追踪，不承诺跨宿主的全局并发配额协同管控，亦不提供分布式跨网络事务保证。
