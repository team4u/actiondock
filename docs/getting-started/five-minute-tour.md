# 五分钟极速上手教程

本教程带领开发者在五分钟内从零初始化一个 Action Package，编写首个强类型 Action，通过纯内存沙箱执行毫秒级单测，并验证命令行、MCP 服务与智能体技能的全模态交付能力。

---

## 前置环境准备

确保本地已安装 Node.js 24.12.0 或更高版本，并在终端全局安装命令行工具：

```bash
npm install -g @actiondock/cli
```

---

## 创建并初始化项目

在终端执行初始化命令创建项目目录并安装基础依赖：

```bash
ad init math-tools
cd math-tools
npm install
```

初始化完成后，项目目录包含标准工程结构：

```text
math-tools/
├── actiondock.json       # 项目元数据、配置项与动作清单唯一事实源
├── package.json          # 依赖声明与测试脚本
├── tsconfig.json         # TypeScript 配置
├── actions/              # 原子 Action 源码目录
├── playbooks/            # 操作规程目录
└── tests/                # 单元测试目录
```

---

## 声明与编写首个 Action

ActionDock 遵循单一事实源原则。所有动作的标识、模式定义与描述统一在 `actiondock.json` 中声明。

### 声明动作元数据

检查或编辑 `actiondock.json`，声明加法计算动作 `math.add`：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "math-tools",
  "name": "Math Tools",
  "version": "0.1.0",
  "description": "基础数学计算工具集",
  "actions": {
    "math.add": {
      "entry": "actions/add.ts",
      "description": "执行两数相加并返回求和结果",
      "inputSchema": {
        "type": "object",
        "properties": {
          "a": { "type": "number", "description": "加数" },
          "b": { "type": "number", "description": "被加数" }
        },
        "required": ["a", "b"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "result": { "type": "number", "description": "计算结果" }
        },
        "required": ["result"]
      }
    }
  }
}
```

### 编写动作业务逻辑

在 `actions/add.ts` 中实现具体的计算逻辑。业务代码仅依赖轻量的 `@actiondock/sdk`：

```ts
import { defineAction } from "@actiondock/sdk";

export interface AddInput {
  a: number;
  b: number;
}

export interface AddOutput {
  result: number;
}

export default defineAction(async (input: AddInput, ctx): Promise<AddOutput> => {
  ctx.log.info(`计算加法: ${input.a} + ${input.b}`);

  return {
    result: input.a + input.b,
  };
});
```

---

## 编写毫秒级沙箱测试

测试是智能体自主自愈与工程质量的核心保障。在 `tests/add.test.ts` 中编写单测，使用 `@actiondock/testing` 提供的纯内存测试运行时：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import addAction from "../actions/add.js";

describe("math.add 动作测试", () => {
  it("应当正确计算加法结果", async () => {
    const runtime = createTestRuntime();
    const output = await runtime.run(addAction, { a: 12, b: 30 });
    assert.equal(output.result, 42);
  });
});
```

在终端执行测试，无需启动真实服务或外部数据库，亚秒级输出结果：

```bash
npm test
```

---

## 本地命令行执行

使用 `ad run` 命令执行动作，通过标准输入输出验证业务结果与标准化信封：

```bash
ad run math.add --input '{"a": 15, "b": 27}'
```

终端标准输出返回统一的成功信封：

```json
{
  "ok": true,
  "runId": "01JMB394K8V6C1T9A2...",
  "data": {
    "result": 42
  }
}
```

过程诊断日志则自动重定向至标准错误流，彻底隔离数据通道。

---

## 全模态交付体验

同一份 Action 源代码无需任何改动，即可按需交付为多种目标形态：

- 启动为 MCP 协议服务：
  ```bash
  ad mcp
  ```
  立即作为标准输入输出协议服务启动，可直接在 Cursor、Windsurf 或 Claude Desktop 中挂载为工具。

- 导出为 Agent Skill 技能包：
  ```bash
  ad export skill
  ```
  在当前目录下生成自包含的技能资产目录，供智能体客户端自动识别规程与动作。

- 构建可执行 Node.js 目录交付产物：
  ```bash
  ad build
  ```
  在 `.actiondock/build/` 下生成开箱即用的交付产物，锁定生产依赖，随时分发至生产容器中。
