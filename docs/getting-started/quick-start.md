# 快速上手 (Quick Start)

本指南将带您在 3 分钟内完成首个 Action 的创建、本地运行、MCP 直连、独立编译与 Skill 导出。

---

## 1. 创建项目

初始化一个全新的 Action Package 项目骨架：

```bash
ac init hello-tools
cd hello-tools

# SDK 已发布 npm 时：
bun install

# SDK 未发布 npm（本地源码模式，404 即此情况）：
bun link @actiondock/sdk   # 接入本地全局 SDK 并自动补齐其余依赖
```

> **提示**：关于本地开发态 link 原则及企业证书/404 故障排查，详见 [安装与环境准备 (Link 三原则与故障排查)](installation.md#3-依赖安装故障排查与-link-原则)。

目录结构如下：

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

## 2. 编写首个 Action

创建 `actions/hello.ts`：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "hello",
  description: "向指定用户打招呼",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "名字" },
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

  async run(input) {
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

## 4. 交付为多种目标

### A. 作为 MCP 服务直连 IDE
无需编写协议转换代码，直接以 MCP STDIO 模式运行：
```bash
ac mcp
```
在 Claude Code、Cursor 或 Windsurf 中直接将其配置为 MCP Server。

### B. 编译为零依赖独立二进制
```bash
ac build
```
编译产物位于 `./dist/bin/hello-tools`。可在无 Node.js / Bun 环境的目标机器直接运行：
```bash
./dist/bin/hello-tools run hello --input '{"name": "Production"}'
```

### C. 导出为 Agent Skill
```bash
ac export skill
```
导出包含 `SKILL.md` 与 SOP 规程的 Agent Skill，可直接投递给 Claude Code、Codex 或其他 AI 智能体使用。

---

## 下一步

- 阅读 [编写你的第一个业务 Action](first-action.md) 了解配置、持久化与外部 API 调用。
- 探索 [Action Package 核心概念](../concepts/action-package.md)。
