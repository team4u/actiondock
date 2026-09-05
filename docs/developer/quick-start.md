# 快速上手

本指南面向工具创作者，介绍 Action Package 的初始化、编写规范、清单契约复用、本地测试与打包交付流程。

---

## 初始化项目骨架

使用 `ad init` 初始化一个全新的 Action Package 项目骨架：

```bash
ad init my-action
cd my-action
npm install
```

初始化生成的项目目录结构如下：

```text
my-action/
├── actiondock.json           # 项目元数据与配置声明
├── actiondock.manifest.json  # 声明式元数据清单事实源
├── package.json              # 依赖管理与标准测试脚本
├── tsconfig.json             # TypeScript 现代模块规范配置
├── .gitignore                # 版本管理忽略规则
├── actions/                  # 原子 Action 源码目录
│   └── greet.ts              # 脚手架示例 Action 源码
├── playbooks/                # 规程目录
│   └── greet-user.md         # 示例 Playbook 规程
└── tests/                    # 单元测试目录
    └── greet.test.ts         # 测试用例
```

### 标准测试脚本规范

生成的 `package.json` 对齐 Node.js 标准测试规范：

```json
{
  "name": "my-action",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts"
  },
  "dependencies": {
    "@actiondock/sdk": "^2.0.2"
  },
  "devDependencies": {
    "@actiondock/testing": "^2.0.2",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

在 Node.js 24 LTS 底座下，项目默认利用原生 `node:test` 运行器配合 `tsx` 直接加载执行 TypeScript 测试文件，实现零编译等待的亚秒级测试反馈。

---

## 编写 Action 与清单契约复用

### `actions/` 目录编写规范

- **原子单一职责**：每个 Action 源码文件独立存放于 `actions/` 目录下，负责一项明确具体的工具能力。
- **契约默认导出**：每个文件通过 `defineAction` 定义并作为默认导出对象。
- **唯一标识命名**：Action 的 `id` 必须保持唯一，并推荐使用命名空间前缀（例如 `sample.greet` 或 `github.get-pr`）。
- **纯粹物理通道**：业务数据仅通过 `run` 方法返回值输出至标准输出；过程日志一律使用 `ctx.log` 写入标准错误输出，严禁使用 `console.log` 混杂输出流。

### 清单契约复用机制

ActionDock 2.0 引入 `actiondock.manifest.json` 作为声明式元数据清单的事实源。

```json
{
  "schemaVersion": 1,
  "actions": {
    "sample.greet": {
      "entry": "actions/greet.ts",
      "description": "Greeting action demonstrating basic input, config, and state usage",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Name of the person to greet"
          }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" },
          "timesGreeted": { "type": "number" }
        },
        "required": ["message", "timesGreeted"]
      },
      "uses": [],
      "tags": ["sample"]
    }
  },
  "assets": []
}
```

声明式清单带来以下核心优势与复用方式：

- **无代码执行的静态分析**：在构建规划器裁剪依赖、MCP 协议暴露工具列表或文档生成时，框架直接读取静态清单，无需执行 Action 的 TypeScript 源码，杜绝副作用与安全隐患。
- **契约双向同步**：通过 `ad action create <id>` 命令行脚手架创建新 Action 时，脚手架会自动在 `actions/` 生成模板源码，并同步向 `actiondock.manifest.json` 注册元数据契约。
- **运行期与编译期双重保障**：源码中的 `defineAction` 负责类型推导与内存执行，静态清单负责工具链闭包依赖计算与外部协议暴露。

### Action 源码示例

在 `actions/greet.ts` 中实现动作逻辑：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.greet",
  description: "问候用户的示例动作，演示入参、配置与状态的基本用法",

  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "被问候者的姓名",
      },
    },
    required: ["name"],
  },

  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      timesGreeted: { type: "number" },
    },
    required: ["message", "timesGreeted"],
  },

  async run(input: { name: string }, ctx) {
    // 读取配置项（多级回退）
    const greeting = ctx.config.get("SAMPLE_GREETING", "Hello");

    // 读取并自增状态计数
    const count = ((await ctx.state.get<number>("greet_count")) || 0) + 1;
    await ctx.state.set("greet_count", count);

    // 记录结构化诊断日志（输出至 stderr）
    ctx.log.info(`问候 ${input.name}，累计问候次数：${count}`);

    return {
      message: `${greeting}, ${input.name}!`,
      timesGreeted: count,
    };
  },
});
```

---

## 本地执行与调试

使用 `ad run`（或 `ad action run`）在本地调用并测试 Action：

```bash
ad run sample.greet --input '{"name": "ActionDock"}'
```

输出标准信封结构数据：

```json
{
  "ok": true,
  "runId": "01JXYZ789...",
  "data": {
    "message": "Hello, ActionDock!",
    "timesGreeted": 1
  }
}
```

---

## 运行单元测试

在 `tests/greet.test.ts` 中使用 `@actiondock/testing` 验证 Action 行为：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import greetAction from "../actions/greet";

describe("greet action", () => {
  it("应当完成问候并累加状态计数", async () => {
    const runtime = createTestRuntime({
      config: { SAMPLE_GREETING: "Hi" },
    });

    const res1 = await runtime.run(greetAction, { name: "Alice" });
    assert.equal(res1.message, "Hi, Alice!");
    assert.equal(await runtime.state.get("greet_count"), 1);

    const res2 = await runtime.run(greetAction, { name: "Bob" });
    assert.equal(res2.message, "Hi, Bob!");
    assert.equal(await runtime.state.get("greet_count"), 2);
  });
});
```

执行测试套件：

```bash
npm test
# 或使用 CLI 命令
ad test
```

---

## 打包与产物交付

- **导出为 Agent Skill 产物**：
  ```bash
  ad export skill
  ```
  产物生成在 `./dist/my-action-skill/` 目录下，包含标准 `SKILL.md` 与精简清单，可直接交付给各类 AI 智能体使用。
- **编译为独立二进制产物**：
  ```bash
  ad build
  ```
  调用外部编译器生成单个零外部依赖的可执行文件，方便在容器或生产服务器上免环境运行。

---

## 下一步导引

- 阅读 [深入业务 Action 开发](first-action.md) 了解真实 API 调用、进程管理与持久化。
- 阅读 [编写 Playbook 规程](playbooks.md) 掌握面向 Agent 的标准化规程沉淀。
- 阅读 [单元测试与沙箱验证](testing.md) 深入探索时钟推进与命令模拟。
- 阅读 [构建、打包与 Skill 导出](build-and-export.md) 了解依赖裁剪与多目标平台交叉编译。
