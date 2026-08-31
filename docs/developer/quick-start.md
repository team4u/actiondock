# 快速上手 (Quick Start)

本指南面向**工具创作者（Developer）**，带您在 3 分钟内完成首个 Action Package 的初始化、编写、本地测试与一键打包。

---

## 1. 初始化项目骨架

使用 `ac init` 初始化全新的 Action Package：

```bash
ac init hello-tools
cd hello-tools

# SDK 已发布 npm 时：
bun install

# SDK 处于本地开发态时（遇到 404 即此情况）：
bun link @actiondock/sdk
```

项目目录结构如下：

```text
hello-tools/
├── actiondock.json       # 项目元数据与配置清单
├── package.json          # 依赖管理
├── tsconfig.json         # TypeScript 配置
├── actions/              # 原子 Action 目录
│   └── greet.ts          # 脚手架示例 Action
├── playbooks/            # 规程 SOP 目录
│   └── greet-user.md     # 示例 Playbook
└── tests/                # 单元测试目录
    └── greet.test.ts     # 内存单测
```

---

## 2. 编写 Action (`defineAction`)

在 `actions/hello.ts` 中定义原子 Action：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "hello",
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
    ctx.logger.info("Executing hello action for", input.name);
    return {
      message: `Hello ${input.name}!`,
    };
  },
});
```

---

## 3. 本地执行与调试

使用 `ac run` 在本地调用 Action：

```bash
ac run hello --input '{"name": "ActionDock"}'
```

输出标准 JSON Envelope：

```json
{
  "ok": true,
  "runId": "01JXYZ...",
  "data": {
    "message": "Hello ActionDock!"
  }
}
```

---

## 4. 运行单元测试

ActionDock 倡导纯内存测试，毫秒级即时反馈：

```bash
ac test
```

---

## 5. 打包与分发交付

### A. 导出为 Agent Skill
```bash
ac export skill
```
产物生成在 `./dist/hello-tools-skill/`，包含 `SKILL.md`，可直接分发给 Claude Code 或 Antigravity 使用。

### B. 编译为零依赖独立二进制
```bash
ac build
```
编译生成单个零外部依赖的可执行程序 `./dist/bin/hello-tools`。

---

## 下一步

- 阅读 [深入业务 Action 开发](first-action.md) 了解配置、持久化与外部 API 调用。
- 探索 [Playbook SOP 规程编写](playbooks.md)。
- 了解 [单元测试与沙箱验证](testing.md)。
