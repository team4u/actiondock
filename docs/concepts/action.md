# 核心概念：Action

**Action** 是 ActionDock 体系中最基础的原子能力单元。

它封装了一个具体的、确定性的任务（如查询数据库、调用第三方 API、处理文本、执行本地命令等），并通过强类型与模式规范约束其输入和输出。

---

## Action 定义模型

在 ActionDock 2.0 中，`actiondock.json` 是元数据与契约模式的唯一事实源。每个 Action 的标识、描述、模式校验及依赖均在清单中声明，源码专注于业务执行逻辑。

### 动作实现代码

使用 [`@actiondock/sdk`](file:///root/code/action-dock/packages/sdk/src/index.ts) 的 [`defineAction`](file:///root/code/action-dock/packages/sdk/src/action.ts) 声明业务执行函数：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
}

export default defineAction<GreetInput, GreetOutput>(async (input, ctx) => {
  return {
    message: `Hello, ${input.name}!`,
  };
});
```

亦支持传入包含 `run` 方法的对象形式：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  async run(input, ctx) {
    return {
      message: `Hello, ${input.name}!`,
    };
  },
});
```

### 清单契约声明

在 `actiondock.json` 中声明 Action 契约：

```json
{
  "schemaVersion": 2,
  "id": "team4u.greeting-tools",
  "actions": {
    "greet": {
      "entry": "actions/greet.ts",
      "description": "向指定用户打招呼",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "用户名" }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"]
      }
    }
  }
}
```

---

## 核心设计原则

### 代码即契约与自愈基准
- 开发阶段：TypeScript 泛型接口 `defineAction<TInput, TOutput>` 提供准确的代码自动补全与静态类型检查。当智能体编写代码时，结构化的模式契约能够有效抑制参数幻觉与输出畸变。
- 运行阶段：`inputSchema` 与 `outputSchema` 基于标准 JSON Schema 执行严格的双向校验。
- 协议层面：自动映射为 MCP 工具描述或智能体技能入参规范，确保下游模型消费接口时的精准理解。

### 纯净的标准输出与通道隔离
- Action 执行过程中的所有返回值由执行器统一封装为结构化 JSON 信封写入标准输出。
- 业务日志和调试诊断通过 `ctx.log` 强制输出至标准错误输出。
- 保证任何调试输出都不会污染标准输出通道，避免破坏模型或自动化流水线的 JSON 数据解析。

### 内存沙箱与智能体自测自愈
- Action 天然支持纯内存沙箱测试。
- 通过 [`createTestRuntime`](file:///root/code/action-dock/packages/sdk/src/test-runtime.ts) 可在毫秒级内注入模拟配置、预填状态并进行断言。
- 当智能体生成 Action 实现代码后，能够依靠这一纯内存测试底座实现本地自治验证；遇到边界失败时，依据精确的错误结构自主修正代码，实现闭环自愈。

### 级联调用与循环检测
- Action 可通过 [`ctx.actions.invoke`](file:///root/code/action-dock/packages/sdk/src/types.ts) 调度下游 Action。
- 严格参数约束：`ctx.actions.invoke` 仅接受动作标识符字符串（短标识符如 `"greet"`、完全限定标识符如 `"shared-pkg/b"`）或 [`ActionRef`](file:///root/code/action-dock/packages/sdk/src/types.ts) 引用对象，严禁传入动作定义对象或函数，防止绕开清单声明、模式校验与运行追踪。
- 依赖声明检查：跨包或本包级联调用必须在清单的 `uses` 字段中显式声明；未声明调用将返回 `UNDECLARED_ACTION_DEPENDENCY`。
- 循环与递归保护：运行时内置防死循环递归检测机制，检测到循环调用时返回 `ACTION_CALL_CYCLE`，超过子运行配额限制时返回 `ACTION_SUBRUN_LIMIT`。

### 外部命令执行与进程治理
- 统一进程接口：通过 [`ctx.process`](file:///root/code/action-dock/packages/sdk/src/types.ts) 调度外部命令，仅提供 `exec` 与 `spawn` 方法，受管子进程统一继承根任务的取消信号与超时控制。
- 防管道死锁：`ctx.process.exec` 一次性异步排空管道，避免子进程继承句柄导致的挂起。
- 缓冲区与取消保护：平台层对标准输出和标准错误设置字节上限，超时或取消时先发送终止信号，宽限期后强制终止受管进程组。
