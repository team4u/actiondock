# 快速上手指南

本指南将带您从零开始，在 5 分钟内完成环境准备、ActionDock 项目初始化、Action 编写与调试、编译为独立二进制以及导出面向 AI Agent 的 Skill 交付包。

---

## 环境准备

ActionDock 2.0 基于 Bun 原生运行时与编译器构建。

### 安装 Bun（如果尚未安装）

* **macOS / Linux**：
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
* **Windows (PowerShell)**：
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```

验证安装：
```bash
bun --version
```

---

## 获取与安装 ActionDock CLI (`ac`)

### 从 npm 仓库安装（发布后）
```bash
bun install -g @actiondock/cli
```

### 从本地源码开发使用
克隆本仓库后，在 `packages/cli` 目录下注册软链接：
```bash
cd packages/cli
bun link
```

验证 `ac` 命令可用性：
```bash
ac --help
```

---

## 初始化首个 ActionDock 项目

使用 `ac init` 初始化一个新的 Action Package：

```bash
ac init github-tools --id myteam.github-tools --name "GitHub Tools" --desc "GitHub 运维与代码评审 Action 集合"
cd github-tools
```

### 项目文件目录结构
```text
github-tools/
├── actiondock.json       # 项目主配置文件
├── package.json          # TypeScript 与依赖配置
├── tsconfig.json         # TS 编译配置
├── actions/              # Action 定义目录
│   └── greet.ts          # 脚手架示例 Action
├── playbooks/            # 任务 SOP 规程目录
│   └── greet-user.md     # 示例 Playbook
└── tests/                # 单元测试目录
    └── greet.test.ts     # 示例单测
```

---

## 编写您的首个 Action

在 `actions/` 目录下创建 `actions/get-user.ts`：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GetUserInput {
  username: string;
}

export interface GetUserOutput {
  id: string;
  name: string;
  url: string;
  fetchedAt: string;
}

export default defineAction<GetUserInput, GetUserOutput>({
  id: "github.get-user",
  description: "根据用户名获取 GitHub 用户公开资料",

  inputSchema: {
    type: "object",
    properties: {
      username: {
        type: "string",
        description: "GitHub 用户名",
      },
    },
    required: ["username"],
  },

  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      url: { type: "string" },
      fetchedAt: { type: "string" },
    },
    required: ["id", "name", "url", "fetchedAt"],
  },

  async run(input, ctx) {
    ctx.log.info(`正在查询用户: ${input.username}`);

    // 使用标准 Web fetch API
    const response = await fetch(`https://api.github.com/users/${input.username}`, {
      headers: {
        "User-Agent": "ActionDock-Agent",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API 请求失败: HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;

    return {
      id: String(data.id),
      name: data.name || data.login,
      url: data.html_url,
      fetchedAt: new Date().toISOString(),
    };
  },
});
```

---

## 本地运行与调试 Action

使用 `ac action run` 在开发态直接执行：

```bash
ac action run github.get-user --input '{"username": "torvalds"}'
```

输出标准 JSON 结果 Envelope（stdout）：
```json
{
  "ok": true,
  "runId": "01J...",
  "data": {
    "id": "1024025",
    "name": "Linus Torvalds",
    "url": "https://github.com/torvalds",
    "fetchedAt": "2026-08-30T07:00:00.000Z"
  }
}
```

---

## 运行单元测试

使用 `ac test` 快速执行基于 `@actiondock/sdk` 的内存单元测试：

```bash
ac test
```

---

## 编译为独立二进制可执行文件

使用 `ac build` 将整个项目编译为零安装独立二进制：

```bash
ac build
```

产物生成于 `dist/bin/github-tools`。该二进制文件**不需要安装任何 Runtime**，可以直接独立运行：

```bash
./dist/bin/github-tools list --json
./dist/bin/github-tools run github.get-user --input '{"username": "torvalds"}'
```

---

## 导出面向 AI Agent 的 Skill 包

使用 `ac export skill` 生成包含 `SKILL.md` 的完整交付包：

```bash
ac export skill
```

导出的目录结构：
```text
dist/github-tools-skill/
├── SKILL.md                  # 包含 YAML Frontmatter 的标准 Agent Skill 任务指南
├── actiondock.skill.json     # 机器可读 Skill 清单
├── playbooks/                # 任务 SOP 规程
└── bin/
    └── github-tools          # 独立自包含二进制
```

将该目录提供给任何支持 Skill 的 AI Agent（如 Antigravity、Claude Code、Cursor 等），Agent 即可自动识别并调用其中的所有 Action！
