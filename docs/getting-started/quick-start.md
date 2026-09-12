# 快速上手指南

本指南带领开发者在数分钟内从零初始化一个 Action Package，掌握单一事实源清单配置、编写强类型 Action 业务逻辑、通过纯内存沙箱执行毫秒级单测，并验证命令行、MCP 服务与智能体技能的全模态交付。

---

## 运行环境准备

确保本地已安装 Node.js 24.12.0 或更高版本，并在终端全局安装 ActionDock 命令行工具：

```bash
npm install -g @actiondock/cli
```

校验安装结果：

```bash
ad --version
```

---

## 初始化项目骨架

在终端执行初始化命令创建项目骨架并安装基础依赖：

```bash
ad init hello-tools
cd hello-tools
npm install
```

初始化生成的标准工程目录结构如下：

```text
hello-tools/
├── actiondock.json       # 项目元数据、配置项与动作清单唯一事实源
├── package.json          # 依赖声明与标准测试脚本
├── tsconfig.json         # TypeScript 现代模块配置
├── actions/              # 原子 Action 源码目录
│   └── greet.ts          # 示例动作业务执行源码
├── playbooks/            # 操作规程目录
│   └── greet-user.md     # 示例操作规程
└── tests/                # 单元测试目录
    └── greet.test.ts     # 单元测试用例
```

### 标准测试脚本规范

生成的 `package.json` 对齐 Node.js 标准测试规范：

```json
{
  "name": "hello-tools",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts"
  },
  "dependencies": {
    "@actiondock/sdk": "^2.2.0"
  },
  "devDependencies": {
    "@actiondock/testing": "^2.2.0",
    "@types/node": "^24.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

在 Node.js 24 原生底座下，项目默认利用原生类型擦除配合 `tsx` 直接加载执行 TypeScript 测试文件，实现零编译等待的亚秒级测试反馈。

---

## 声明与编写 Action

ActionDock 遵循单一事实源原则。所有动作的标识、模式定义与描述统一在 `actiondock.json` 中声明。

### 在 actiondock.json 中声明清单契约

在 `actiondock.json` 中声明配置项与加法计算动作 `math.add`：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "hello-tools",
  "name": "Hello Tools",
  "version": "0.1.0",
  "description": "基础演示工具集",
  "config": {
    "DEFAULT_GREETING": {
      "description": "默认问候语前缀",
      "type": "string",
      "default": "Hello"
    }
  },
  "actions": {
    "sample.greet": {
      "entry": "actions/greet.ts",
      "description": "个性化问候用户并记录问候次数",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "用户姓名" }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" },
          "count": { "type": "number" }
        },
        "required": ["message", "count"]
      }
    }
  }
}
```

### 编写动作业务执行逻辑

在 `actions/greet.ts` 中实现具体的执行逻辑。业务代码仅依赖轻量的 `@actiondock/sdk`：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
  count: number;
}

export default defineAction(async (input: GreetInput, ctx): Promise<GreetOutput> => {
  const prefix = ctx.config.get<string>("DEFAULT_GREETING", "Hello");
  const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
  await ctx.state.set(`greet:${input.name}`, count);

  // 过程日志一律写入 ctx.log（标准错误流），彻底隔离标准输出
  ctx.log.info(`用户 ${input.name} 已问候 ${count} 次`);

  return {
    message: `${prefix}, ${input.name}!`,
    count,
  };
});
```

---

## 编写毫秒级沙箱测试

测试是智能体自主自愈与工程质量的核心保障。在 `tests/greet.test.ts` 中编写测试，使用 `@actiondock/testing` 提供的纯内存测试运行时：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import greetAction from "../actions/greet.js";

describe("sample.greet 动作测试", () => {
  it("应当正确返回问候信息并自增计数", async () => {
    const runtime = createTestRuntime();

    // 第一次调用
    const res1 = await runtime.run(greetAction, { name: "ActionDock" });
    assert.equal(res1.message, "Hello, ActionDock!");
    assert.equal(res1.count, 1);

    // 第二次调用，断言状态持久化自增
    const res2 = await runtime.run(greetAction, { name: "ActionDock" });
    assert.equal(res2.count, 2);
  });
});
```

在终端执行测试，纯内存秒级输出结果：

```bash
npm test
```

---

## 本地命令行执行与通道隔离

使用 `ad run` 命令执行动作，通过标准输入输出验证业务结果与标准化信封：

```bash
ad run sample.greet --input '{"name":"ActionDock"}'
```

标准输出返回统一的结构化成功信封：

```json
{
  "ok": true,
  "runId": "01JMB394K8V6C1T9A2...",
  "data": {
    "message": "Hello, ActionDock!",
    "count": 1
  }
}
```

过程诊断日志则自动重定向至标准错误流，杜绝破坏 JSON 数据报文。

---

## 全模态交付形态

同一份 Action 源代码无需任何改动，即可一键交付为多种目标形态：

- 启动为 MCP 协议服务：
  ```bash
  ad mcp
  ```
  立即作为标准输入输出通信服务启动，可在 Cursor、Windsurf 或 Claude Desktop 中挂载为工具。

- 导出为 Agent Skill 技能包：
  ```bash
  # 导出源码模式技能
  ad export skill

  # 导出自包含 Node.js 目录模式技能
  ad export skill --mode node
  ```
  在当前目录下生成自包含的技能资产，供智能体客户端自动识别规程与动作。

- 构建自包含 Node.js 运行时交付目录：
  ```bash
  ad build
  ```
  生成开箱即用的交付目录产物，内嵌锁定的生产依赖，可直接使用 Node.js 独立运行。
