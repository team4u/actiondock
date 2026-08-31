# 核心概念：Action

**Action** 是 ActionDock 体系中最基础的原子能力单元。

它封装了一个具体的、确定性的任务（如查询数据库、调用第三方 REST API、处理文本、执行本地命令等），并通过强类型与 Schema 约束其输入和输出。

---

## Action 定义模型

在 ActionDock 中，每一个 Action 均使用 `@actiondock/sdk` 的 `defineAction` 声明：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
}

export default defineAction<GreetInput, GreetOutput>({
  id: "greet",
  description: "向指定用户打招呼",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "用户名" },
    },
    required: ["name"],
  },

  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },

  async run(input, ctx) {
    return {
      message: `Hello, ${input.name}!`,
    };
  },
});
```

---

## 核心设计原则

### 1. 代码即契约（Code as Contract）
- **开发态**：TypeScript 泛型接口 `defineAction<TInput, TOutput>` 为开发者提供丝滑的代码自动补全与静态类型检查。
- **运行态**：`inputSchema` 与 `outputSchema` 基于标准 JSON Schema（Ajv 引擎）执行严格的双向校验。
- **协议层**：自动映射为 MCP Tool 描述或 Agent Skill 入参规范，杜绝大模型幻觉与参数传递错误。

### 2. 纯净的标准输出（Physical Channel Isolation）
- Action 执行过程中的所有返回值由执行器统一封装为结构化 **JSON Envelope** 写入 `stdout`。
- 业务日志和调试诊断通过 `ctx.log` 强制输出至 `stderr`。
- 保证任何调试输出都不会破坏大模型或下游管道的 JSON 解析。

### 3. 可测试与零副作用沙箱
- Action 设计为天然支持纯内存沙箱测试。
- 通过 `createTestRuntime` 可在毫秒级内注入 Mock 配置、预填状态并进行断言。

### 4. 级联调用与循环检测
- Action 可通过 `ctx.actions.invoke("other-action", input)` 组合调用其他 Action。
- 运行时内置防死循环递归检测机制（`ACTION_CYCLE_DETECTED`），最大调用深度受控。
