# 快速上手指南

本指南将带您在 5 分钟内从零开始完成环境准备、ActionDock 项目脚手架初始化、Action 编写与调试、内存单元测试、编译为独立可执行二进制以及导出面向 AI Agent 的自包含 Skill 交付包。

---

## 环境准备

ActionDock 2.0 基于 Bun 原生运行时与单文件编译器构建。

### 安装 Bun（若尚未安装）

* **macOS / Linux**：
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
* **Windows** (PowerShell)：
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```

验证安装：
```bash
bun --version
```

---

## 安装 ActionDock CLI (`ac`)

### 方式一：从 npm 仓库全局安装（推荐）

```bash
bun install -g @actiondock/cli
```

### 方式二：从本地源码仓库注册软链接（框架贡献者）

```bash
git clone git@github.com:team4u/actiondock.git
cd actiondock/packages/cli
bun link
```

验证 `ac` 命令行可用性：
```bash
ac --help
```

---

## 初始化首个 Action Package 项目

使用 `ac init` 初始化脚手架项目：

```bash
ac init github-tools --id team4u.github-tools --name "GitHub Tools" --desc "GitHub 自动化运维与代码评审工具集"
cd github-tools
```

### 项目文件目录结构

```text
github-tools/
├── actiondock.json       # 项目主配置文件（声明 packageId、名称、描述及配置项默认值）
├── package.json          # TypeScript 与依赖配置
├── tsconfig.json         # TypeScript 编译配置
├── actions/              # Action 定义目录
│   └── greet.ts          # 脚手架生成的示例 Action
├── playbooks/            # 任务 SOP 操作规程目录
│   └── greet-user.md     # 示例 Playbook SOP
└── tests/                # 单元测试目录
    └── greet.test.ts     # 示例内存单测
```

---

## 编写您的首个 Action

在 `actions/` 目录下创建 `actions/get-user.ts`：

```ts
import { defineAction } from "@actiondock/sdk";

// 定义 TypeScript 接口（用于 IDE 智能补全与静态检查）
export interface GetUserInput {
  username: string;
}

export interface GetUserOutput {
  id: string;
  name: string;
  url: string;
  bio?: string;
  fetchedAt: string;
}

// 使用 defineAction 声明 Action
export default defineAction<GetUserInput, GetUserOutput>({
  id: "github.get-user",
  description: "根据 GitHub 用户名获取其公开个人资料",

  // 入参标准 JSON Schema（用于参数严格校验与 Agent 工具发现）
  inputSchema: {
    type: "object",
    properties: {
      username: {
        type: "string",
        description: "GitHub 用户名（如 torvalds）",
      },
    },
    required: ["username"],
  },

  // 出参标准 JSON Schema（用于结果结构校验）
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      url: { type: "string" },
      bio: { type: "string" },
      fetchedAt: { type: "string" },
    },
    required: ["id", "name", "url", "fetchedAt"],
  },

  // 核心执行逻辑
  async run(input, ctx) {
    // 读取配置（自动支持：CLI 覆盖 > 本地/全局 SQLite > 环境变量 > 声明默认值）
    const token = ctx.config.get<string>("GITHUB_TOKEN");

    // 打印结构化日志（强制输出至 stderr，确保 stdout 仅保留纯净 JSON 数据）
    ctx.log.info(`正在查询 GitHub 用户: ${input.username}`);

    // 使用标准 Web fetch API，并透传 ctx.signal 实现超时与外部协作式取消
    const headers: Record<string, string> = {
      "User-Agent": "ActionDock-QuickStart",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`https://api.github.com/users/${input.username}`, {
      headers,
      signal: ctx.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub API 请求失败: HTTP ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    // 记录持久化状态（跨执行保留）
    await ctx.state.set("last_queried_user", input.username, 3600); // 1 小时 TTL

    return {
      id: String(data.id),
      name: data.name || data.login,
      url: data.html_url,
      bio: data.bio || undefined,
      fetchedAt: new Date().toISOString(),
    };
  },
});
```

---

## 本地运行与调试 Action

使用 `ac action run`（简写为 `ac run`）直接执行 Action：

```bash
ac run github.get-user --input '{"username": "torvalds"}'
```

### 标准输出解析（stdout vs stderr）

* `stdout` （标准 JSON Envelope，供 AI Agent 或程序安全解析）：
  ```json
  {
    "ok": true,
    "runId": "01JXYZ7890ABC...",
    "data": {
      "id": "1024025",
      "name": "Linus Torvalds",
      "url": "https://github.com/torvalds",
      "bio": "Creator of Linux and Git",
      "fetchedAt": "2026-08-30T08:00:00.000Z"
    }
  }
  ```

* `stderr` （诊断与运行日志）：
  ```text
  [08:00:00] [INFO] [github.get-user] 正在查询 GitHub 用户: torvalds
  ```

> [!TIP]
> **依赖自动补齐（Auto-Install）与包管理器支持**：
> - 若您的 Action 引用了项目中尚未安装的 npm 包，`ac run` 会在后台自动探测并调用包管理器（按 `bun install` -> `pnpm install` -> `yarn install` -> `npm install` 自动降级适配）补齐依赖并继续执行，无需手动打断。
> - 同时您也可以随时使用常规的 `npm install`（Node.js 自带）手动管理依赖；只要项目根目录下存在 `node_modules`，ActionDock 将直接加载运行。

---

## 编写内存单元测试

在 `tests/get-user.test.ts` 中使用 `@actiondock/sdk` 的 `createTestRuntime` 编写轻量内存单测：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import getUserAction from "../actions/get-user";

describe("github.get-user Action 测试", () => {
  it("在内存测试运行时中正确执行", async () => {
    // 创建轻量内存测试环境（支持注入 Mock 配置与初始状态）
    const runtime = createTestRuntime({
      config: {
        GITHUB_TOKEN: "mock-token-xyz",
      },
    });

    const result = await runtime.run(getUserAction, {
      username: "torvalds",
    });

    expect(result.id).toBeDefined();
    expect(result.name).toBe("Linus Torvalds");
    expect(runtime.logger.logs.length).toBeGreaterThan(0);

    // 验证状态持久化写入
    const lastUser = await runtime.state.get("last_queried_user");
    expect(lastUser).toBe("torvalds");
  });
});
```

运行测试：
```bash
ac test
```

---

## 编译为独立二进制可执行文件

使用 `ac build` 将整个 Action Package 编译为零外部安装依赖的单文件独立二进制：

```bash
ac build
```

编译产物位于 `dist/bin/github-tools`。该二进制文件**不需要目标机器安装 Node.js、Bun、Python 或 Java**，直接在终端执行：

```bash
# 发现工具
./dist/bin/github-tools list --json

# 查看入参 Schema
./dist/bin/github-tools describe github.get-user --json

# 执行 Action
./dist/bin/github-tools run github.get-user --input '{"username": "torvalds"}'
```

---

## 导出面向 AI Agent 的 Skill 交付包

使用 `ac export skill` 生成标准的 Agent Skill 交付包：

```bash
ac export skill
```

导出的目录结构：
```text
dist/github-tools-skill/
├── SKILL.md                  # 面向 AI Agent 的主引导手册（含 YAML Frontmatter）
├── actiondock.skill.json     # 机器可读的结构化清单（全量 Action Schema）
├── playbooks/                # 任务 SOP 规程目录
│   └── greet-user.md
└── bin/
    └── github-tools          # 独立自包含二进制
```

将该目录提供给任何支持 Skill 规范的 AI Agent（如 Antigravity、Claude Code、Cursor、Windsurf），Agent 将自动识别工具能力、阅读规程并执行调用！

---

## 进阶阅读与下一步

- [Action 编写与开发指南](action-authoring.md)：深入学习 Schema 校验、标准 Web API 与复合 Action 编排。
- [ActionContext 核心能力详解](action-context.md)：探索 5 级配置解析、持久化状态 TTL 与协作式取消机制。
- [Skill 设计哲学与交付规范](skill-guide.md)：掌握任务驱动按需导出（Tree-shaking）与多平台交叉编译。
- [Model Context Protocol 适配器指南](mcp-integration.md)：将项目一键作为 STDIO 或 HTTP MCP Tool Server 暴露给 IDE。
