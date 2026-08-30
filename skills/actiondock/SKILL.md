---
name: actiondock
description: 使用 ActionDock 2.0 (ac CLI, Bun + TypeScript) 进行 AI Agent Action 与 Skill 的创建、开发、测试、独立构建、多云调度与导出的完整工具链指南。
---

# ActionDock 2.0 (ac) 开发者技能指南

ActionDock 2.0 是一个面向 AI Agent Action 与 Skill 的开发工具链（CLI 命令为 `ac`）。它通过 Bun 原生编译器将 TypeScript 编写的 Action 一键打包为**零外部安装依赖的独立二进制可执行文件**，并生成包含 `SKILL.md` 引导的自包含 Skill 包。

---

## CLI 安装与获取方式

安装与获取方式（npm 安装、本地源码软链等）详见[仓库 README](../../README.md#安装与使用方式)，最常用方式：

```bash
bun install -g @actiondock/cli   # npm 发布后：全局安装，即刻可用 ac
# 本地源码开发态：cd packages/cli && bun link（修改源码实时生效）
```

---

## 项目与包管理

### 1. 初始化新项目
```bash
ac init [directory] --id <package-id> --name <display-name> --desc <description>
```
自动生成 `actiondock.json`、`package.json`、`tsconfig.json`、`actions/`、`playbooks/` 与 `tests/` 骨架。

### 2. 检查项目或远程目标元数据
```bash
ac info [--json]
ac info --profile <profile-name> [--json]
```

### 3. 全局包注册与解绑 (Link / Unlink)
在 Action Package 根目录注册后，可在系统任意位置直接运行或被跨包引用：
```bash
ac link [path]          # 注册当前或指定包到全局开发态注册表
ac unlink [id|path]     # 从全局注册表中移除
```

---

## Action 创建与编写规范

### 脚手架创建 Action
```bash
ac action create <action-id> --desc "Action 功能描述" [--file <filename.ts>]
```

### Action 定义结构
每个 Action 放置于 `actions/<name>.ts` 中，使用 `@actiondock/sdk` 的 `defineAction` 声明：

```ts
import { defineAction } from "@actiondock/sdk";

export interface Input {
  repo: string;
  maxCount?: number;
}

export interface Output {
  items: Array<{ id: string; title: string }>;
  total: number;
}

export default defineAction<Input, Output>({
  id: "github.list-issues",
  description: "获取指定 GitHub 仓库的 Issues 清单",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "仓库地址（owner/repo 格式）" },
      maxCount: { type: "number", default: 10 },
    },
    required: ["repo"],
  },

  outputSchema: {
    type: "object",
    properties: {
      items: { type: "array" },
      total: { type: "number" },
    },
    required: ["items", "total"],
  },

  async run(input, ctx) {
    // Config: 命令行覆盖 > 本地 SQLite > 默认配置
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");

    // State: 跨执行持久化 Key-Value 存储（支持指定 TTL 秒数）
    const lastSync = await ctx.state.get<string>("last_sync");
    await ctx.state.set("last_sync", new Date().toISOString(), 3600); // 1 小时后过期

    // Logger: 输出至 stderr（绝不污染 stdout 的标准 JSON 输出）
    ctx.log.info(`正在获取 ${input.repo} 的 issues`);

    // Signal: 标准 AbortSignal 取消信号（支持外部 Ctrl+C、超时及 MCP 客户端取消）
    // const res = await fetch(api, { signal: ctx.signal });

    // Action 组合: 跨 Action 组合调用（具备自动循环调用检测、取消信号向下传播与父子 Run 关联）
    // const detail = await ctx.actions.invoke(otherAction, { ... });

    return {
      items: [],
      total: 0,
    };
  },
});
```

---

## 开发、验证与运行

### 发现与模糊意图检索 Action 清单
```bash
ac action list [--json]
ac action list pr issue [--json]                      # 多关键字模糊匹配
ac action list -i "pr|issue" [--json]                 # 正则意图过滤（未命中默认回退全量）
ac action list -i "nomatch" --no-fallback [--json]    # 禁用未命中回退
ac action list --profile <profile-name> -i "<regex>"  # 远程云机器意图检索
```

### 校验 Action 语法与 Schema
```bash
ac action validate [id] [--json]
```

### 查看 Action 详情与 Schema 定义
```bash
ac action show <id> [--json]
ac action show <id> --profile <profile-name> [--json]
```


### 运行 Action（stdout 输出标准 JSON 结果）
```bash
# 简写方式 (ac run)
ac run <id> --input '{"repo": "owner/repo"}'
ac run <id> --input-file ./input.json
ac run <id> --config GITHUB_TOKEN=secret_token
ac run <id> --timeout 30s                       # 设置超时自动终止（支持 500ms, 30s, 5m, 1h）

# 完整子命令方式 (ac action run)
ac action run <id> -i '{"repo": "owner/repo"}' --timeout 1m
```

标准输出格式：
```json
{
  "ok": true,
  "runId": "01J...",
  "data": { ... }
}
```

> **自动依赖管理**：若 Action 依赖了未安装的 npm 包，`ac run` 运行时会自动触发 `bun install` 毫秒级补齐依赖并继续执行，安装日志输出至 `stderr`，确保 `stdout` 始终为纯净 JSON。  
> **响应式取消**：支持通过 `Ctrl+C` 传播终止信号给底层 Action（通过 `ctx.signal`），超时或主动取消时 RunRecord 将准确记录为 `ACTION_TIMEOUT`（failed）或 `ACTION_CANCELLED`（cancelled）。

---

## 多环境与远程云机器调度 (Profiles & Serve)

### 1. 远端云机器启动 HTTP Runner
在云端主机上启动微型监听服务（默认安全绑定 `127.0.0.1`，公网/局域网暴露强制要求 Token）：
```bash
# 本地监听
ac serve [--port 5177] [--token <secret-token>]

# 暴露给局域网或反向代理（必须配置 --token 或设置 ACTIONDOCK_TOKEN 环境变量）
ac serve --host 0.0.0.0 --token <secret-token> [--cors-origin <origin>] [--max-body 1mb]
```

### 2. 本地管理 Profile
```bash
# 添加云节点（推荐使用 --token-env 指定环境变量名，避免明文持久化）
export ACTIONDOCK_ALIYUN_PROD_TOKEN=secret123
ac profile add aliyun-prod --server http://1.2.3.4:5177 --token-env ACTIONDOCK_ALIYUN_PROD_TOKEN --desc "阿里云生产节点"

# 列出所有已配置的 profile（默认掩码脱敏，支持 --reveal 明文显示）
ac profile list [--reveal] [--json]

# 测试云节点连通性与延迟
ac profile test aliyun-prod

# 切换全局默认 profile
ac profile use aliyun-prod

# 查看或删除 profile
ac profile show [name] [--reveal] [--json]
ac profile rm <name>
```

### 3. 调度远端 Action 执行
```bash
# 同步执行：通过 --profile 调度（自动按 5-tier 多级回退解析 Token）
ac run check-disk --profile aliyun-prod -i '{"mount": "/data"}'

# 异步执行：提交长耗时任务，立即返回 202 Accepted 与 runId（由 Server 持续运行）
ac run sync-database --profile aliyun-prod --async

# 查询远端任务执行详情与状态
ac runs show <run-id> --profile aliyun-prod [--json]

# 主动取消远端正在执行的任务
ac runs cancel <run-id> --profile aliyun-prod [--reason "手动中止"]

# 直接传 server 地址调度
ac run check-disk --server http://1.2.3.4:5177 --token secret123
```


---

## Model Context Protocol (MCP) 服务

ActionDock 2.0 原生支持作为 **Model Context Protocol (MCP)** 服务端运行，将项目中定义的所有 Action 自动暴露为标准 MCP Tools，供 Claude Code、Cursor、VS Code、Windsurf 等任意 MCP Host 直接连接调用。

### 1. STDIO 模式（本地 Agent / 桌面 IDE 直连）
```bash
ac mcp                          # 默认启动当前目录 package 的 MCP STDIO 服务
ac mcp --dir ./examples/github-tools
ac mcp --package team4u.github-tools
ac mcp --timeout 30s            # 限制单次 Tool 调用超时
```

#### MCP Host 配置示例 (Claude Code / Cursor / VS Code)：
```json
{
  "mcpServers": {
    "github-tools": {
      "command": "bunx",
      "args": ["@actiondock/cli", "mcp", "--dir", "/path/to/my-tools"]
    }
  }
}
```

### 2. HTTP 模式（远程微服务 / Streamable HTTP）
```bash
# 启动 MCP HTTP 服务（默认监听 127.0.0.1:5178，MCP 端点为 /mcp）
ac mcp serve --port 5178

# 局域网/公网暴露（强制要求 Token 认证）
ac mcp serve --host 0.0.0.0 --port 5178 --token <secret-token>
```

#### MCP 核心特性保证：
* **Schema 零冗余**：基于官方 `@modelcontextprotocol/server`，自动将 Action 的 JSON Schema 转换为 MCP Tool Schema，无需重复定义。
* **统一执行核心**：所有 MCP Tool 调用继续流经 `ActionRunner`，完全享有输入/输出校验、SQLite `runs` 记录追踪与上下文能力。
* **双向取消链路**：MCP 客户端发出的取消请求（`notifications/cancelled`）会直通 Action 内部的 `ctx.signal`，及时中止耗时计算与网络请求。

---

## Playbook 任务 SOP 指南

Playbook（`playbooks/*.md`）为 AI Agent 提供领域任务的逐步操作规程（SOP）：

### 1. 创建 Playbook
```bash
ac playbook create <id> --desc "SOP 任务描述" --actions action-a action-b
```

### 2. 检查与校验 Playbook
```bash
ac playbook list [patterns...] [-i "<regex>"] [--json]
ac playbook show <id> [--json]
ac playbook validate
```

### 3. 任务驱动一键导出 Skill
指定 Playbook 后，系统会自动提取其 `actions` 依赖，仅将所需 Action 编译进二进制，并生成对应的独立 Skill 包：
```bash
ac export skill --playbook <playbook-id>
```

---

## 运行时存储管理（Config & State）

### 配置管理 (`ctx.config`)
ActionDock 支持**全局配置**（`~/.actiondock/global.db`）与**项目级配置**两级存储：
```bash
ac config list [patterns...] [-P <pkg>] [-g] [--json]
ac config get <key> [-P <pkg>] [-g] [--json]
ac config set <key> <value> [-g]                  # 不在项目目录时自动全局生效，或传 -g 强制全局
ac config delete <key> [-g]
```

### 状态管理 (`ctx.state`)
```bash
ac state list [prefix] [-i "<regex>"] [--json]
ac state get <key> [--json]
ac state set <key> <json-value> [--ttl <seconds>]
ac state delete <key>
```

### 执行历史与任务取消
```bash
ac runs list [patterns...] [-i "<regex>"] [--action <id>] [--limit 20] [--json]
ac runs show <run-id> [--json]
ac runs show <run-id> --profile <profile-name> [--json]       # 查询远程运行详情
ac runs cancel <run-id> --profile <profile-name> [--json]     # 取消远端运行中的任务
```



---

## 单元测试 Action

使用 `@actiondock/sdk` 提供的 `createTestRuntime` 内存测试运行时：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import myAction from "../actions/my-action";

describe("my-action", () => {
  it("使用 Mock 配置、状态与取消信号正常执行", async () => {
    const controller = new AbortController();
    const runtime = createTestRuntime({
      config: { GITHUB_TOKEN: "mock-token" },
      state: { last_sync: "2026-01-01" },
      signal: controller.signal,
    });

    const res = await runtime.run(myAction, { repo: "test/repo" });
    expect(res.total).toBe(0);
    expect(await runtime.state.get("last_sync")).toBeDefined();
  });
});
```

执行测试：
```bash
ac test
# 或
bun test
```

---

## 构建与 Skill 导出

ActionDock 支持**全量打包（默认）**与**按需精准打包（任务驱动 / 工具驱动）**两种模式：

### 1. 构建独立可执行文件 (`ac build`)
```bash
# 全量构建：打包项目中全部 Action
ac build [--target <target>] [--out <path>] [--minify]

# 按需构建：仅将指定 Action 编译进独立二进制
ac build --actions github.get-pr github.review-pr
```

### 2. 导出 Skill 交付包 (`ac export skill`)
```bash
# 全量导出（默认）：包含所有 Action 和所有 Playbook
ac export skill [--target <target>] [--out <path>] [--archive]

# 任务驱动按需导出（推荐）：仅打包指定 Playbook 及其依赖的 Actions（自动 Tree-shaking 裁剪）
ac export skill --playbook review-pr [-o <path>] [-z]
ac export skill --playbook review-pr deploy-service

# 工具驱动按需导出：仅打包指定 Actions，并自动裁剪依赖未包含 Action 的 Playbooks
ac export skill --actions github.get-pr github.review-pr
```

### 生成的 Skill 目录结构：
```text
dist/<package>-skill/
├── SKILL.md                  # 面向 AI Agent 的调用说明（自动生成 Action 与 Playbook 索引）
├── actiondock.skill.json     # 机器可读的 Skill 清单
├── playbooks/                # 任务 SOP Markdown 引导文档（按需打包时仅含匹配的 SOP）
└── bin/
    └── <package>             # 零安装独立可执行文件（仅含已打包 Action）
```
