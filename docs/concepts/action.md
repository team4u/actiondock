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

### 代码即契约与自愈基准
- **开发态**：TypeScript 泛型接口 `defineAction<TInput, TOutput>` 提供准确的代码自动补全与静态类型检查。当智能体负责编写代码时，结构化的模式契约能够有效抑制参数幻觉与输出畸变。
- **运行态**：`inputSchema` 与 `outputSchema` 基于标准 JSON Schema 执行严格的双向校验。
- **协议层**：自动映射为 MCP 工具描述或智能体技能入参规范，确保下游模型消费接口时的精准理解。

### 纯净的标准输出与通道隔离
- Action 执行过程中的所有返回值由执行器统一封装为结构化 JSON 信封写入 `stdout`。
- 业务日志和调试诊断通过 `ctx.log` 强制输出至 `stderr`。
- 保证任何调试输出都不会污染标准输出通道，避免破坏模型或自动化流水线的 JSON 数据解析。

### 内存沙箱与智能体自测自愈
- Action 设计为天然支持纯内存沙箱测试。
- 通过 `createTestRuntime` 可在毫秒级内注入模拟配置、预填状态并进行断言。
- 当智能体生成 Action 实现代码后，能够依靠这一纯内存测试底座实现本地自治验证；遇到边界失败时，依据精确的错误结构自主修正代码，实现闭环自愈。

### 级联调用与循环检测
- Action 可通过 [`ctx.actions.invoke`](file:///root/code/action-dock/packages/sdk/src/types.ts) 灵活组合调用其他 Action，支持传入动作定义对象、短标识符（如 `"b"`）、跨包限定标识符（如 `"shared-pkg/b"`）或 [`ActionRef`](file:///root/code/action-dock/packages/sdk/src/types.ts) 引用对象。
- 彻底解耦动作互调对相对文件路径的直接依赖，支持自包含技能资产闭包导出与全局挂载包共享寻址。
- 运行时内置防死循环递归检测机制（`ACTION_CYCLE_DETECTED`），最大调用深度受控。

### 跨平台 CLI 调度与防死锁
- **Windows 批处理兼容**：npm 全局安装的命令均为 `.cmd` 批处理文件，必须通过路径解析完整绝对路径后再执行。
- **常规命令防管道死锁**：外部子进程残留管道句柄时，异步流读取会导致 EOF 永久阻塞。常规外部命令推荐使用 `ctx.process.exec` 一次性同步排空管道。
- **拉起守护进程命令**：常驻守护进程继承管道句柄会导致同步等待永不 EOF 挂死，推荐使用 `ctx.process.spawnDetached` 机制（标准输入输出解耦异步启动加就绪探针轮询检测）。
- **取消响应与退出码策略**：在多步命令间检测 `ctx.signal?.aborted` 响应取消；非零退出码由调用方根据业务逻辑判定分支。


