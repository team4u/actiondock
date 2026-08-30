---
name: actiondock
description: 使用 ActionDock 2.0 (ac CLI, Bun + TypeScript) 进行 AI Agent Action 与 Skill 的创建、开发、测试、独立构建、多云调度与导出的完整工具链指南。
---

# ActionDock 2.0 (ac) 开发者技能指南

ActionDock 2.0 是面向 AI Agent Action 与 Skill 的开发工具链（CLI 门面命令为 **`ac`**）。它通过 Bun 原生编译器将 TypeScript 编写的 Action 一键打包为**零外部安装依赖的独立二进制可执行文件**，并生成包含 `SKILL.md` 引导的自包含 Skill 交付包。

---

## 1. CLI 安装与环境初始化

### 安装方式
```bash
# npm 全局安装（发布后）
bun install -g @actiondock/cli

# 本地源码开发态（修改源码实时生效）
cd packages/cli && bun link
```

### 初始化新项目
```bash
ac init [directory] --id <package-id> --name <display-name> --desc <description>
```
自动生成包含 `actiondock.json`、`package.json`、`tsconfig.json`、`actions/`、`playbooks/` 与 `tests/` 的完整工程骨架。

### 检查项目或远程目标元数据
```bash
ac info [--json]
ac info --profile <profile-name> [--json]
```

### 全局包注册与解绑 (Link / Unlink)
```bash
ac link [path]          # 注册当前或指定包到全局开发态注册表
ac unlink [id|path]     # 从全局注册表中移除
```

---

## 2. Action 创建与编写规范

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
      repo: { type: "string", description: "仓库全名（owner/repo 格式）" },
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
    // 1. Config: 命令行覆盖 > 本地 SQLite > 默认配置
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");

    // 2. State: 跨执行持久化 Key-Value 存储（支持指定 TTL 秒数）
    const lastSync = await ctx.state.get<string>("last_sync");
    await ctx.state.set("last_sync", new Date().toISOString(), 3600); // 1 小时后过期

    // 3. Logger: 输出至 stderr（绝不污染 stdout 的标准 JSON 输出）
    ctx.log.info(`正在获取 ${input.repo} 的 issues`);

    // 4. Signal: 标准 AbortSignal 取消信号（支持外部 Ctrl+C、超时及 MCP 客户端取消）
    // const res = await fetch(api, { signal: ctx.signal });

    // 5. Action 组合: 跨 Action 组合调用（具备自动循环依赖检测、取消信号向下传播与父子 Run 级联）
    // const detail = await ctx.actions.invoke(otherAction, { ... });

    return {
      items: [],
      total: 0,
    };
  },
});
```

---

## 3. 开发、验证与运行

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

### 运行 Action（stdout 输出标准 JSON Envelope）
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

> [!NOTE]
> **依赖自动管理**：若 Action 依赖了未安装的 npm 包，`ac run` 运行时会自动触发 `bun install` 毫秒级补齐依赖并继续执行，安装日志输出至 `stderr`，确保 `stdout` 始终为纯净 JSON。

---

## 4. 多环境与远程云机器调度 (Profiles & Serve)

### 1. 远端云机器启动 HTTP Runner
```bash
# 本地监听（默认安全绑定 127.0.0.1:5177）
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

# 测试云节点连通性与网络延迟
ac profile test aliyun-prod

# 切换全局默认激活的 profile
ac profile use aliyun-prod

# 查看或删除 profile
ac profile show [name] [--reveal] [--json]
ac profile rm <name>
```

### 3. 异步长任务调度 (Async Execution)
```bash
# 提交远端异步长任务，立即返回 202 Accepted 与 runId
ac run sync-database --profile aliyun-prod --async -i '{"database": "analytics"}'

# 追踪与取消异步任务（本地与远程通用）
ac runs show <run-id> [--server http://127.0.0.1:5177 | --profile aliyun-prod]
ac runs cancel <run-id> [--server http://127.0.0.1:5177 | --profile aliyun-prod] [--reason "手动中止"]
```

---

## 5. Model Context Protocol (MCP) 服务

ActionDock 2.0 原生支持作为 MCP 服务端运行，将项目中定义的所有 Action 自动暴露为标准 MCP Tools：

### 1. STDIO 模式（本地 Agent / 桌面 IDE 直连）
```bash
ac mcp                                      # 默认启动当前目录 package 的 MCP STDIO 服务
ac mcp -d ./pkg-github -d ./pkg-slack       # 同时加载并暴露多个本地目录的 Action Packages
ac mcp --package github-tools,slack-tools   # 指定多个已 link 的 Package ID
ac mcp --all                                # 自动聚合全局 Registry 中所有已 link 的 Action Packages
ac mcp --timeout 30s                        # 限制单次 Tool 调用超时
```

### 2. HTTP 模式（远程微服务 / Streamable HTTP）
```bash
# 启动 MCP HTTP 服务（默认监听 127.0.0.1:5178，端点为 /mcp）
ac mcp serve --port 5178

# 局域网/公网暴露（强制要求 Token 认证）
ac mcp serve --host 0.0.0.0 --port 5178 --token <secret-token>
```

### 3. MCP Tasks 长任务扩展 (`io.modelcontextprotocol/tasks`)
- 异步调用：`tools/call` 传入 `execution: { mode: "async" }`，立即返回 `taskId`（等价于全局 `runId`）。
- 状态查询与取消：支持 `tasks/get`、`tasks/cancel`（直通底层 `ctx.signal`）与 `tasks/list`。

---

## 6. Playbook 任务 SOP 规程

Playbook（`playbooks/*.md`）为 AI Agent 提供领域任务的标准操作规程：

```bash
ac playbook create <id> --desc "SOP 任务描述" --actions action-a action-b
ac playbook list [patterns...] [-i "<regex>"] [--json]
ac playbook show <id> [--json]
ac playbook validate
```

---

## 7. 运行时存储管理 (Config & State)

### 配置管理 (`ctx.config`)
```bash
ac config list [patterns...] [-P <pkg>] [-g] [--json]
ac config get <key> [-P <pkg>] [-g] [--json]
ac config set <key> <value> [-g]
ac config delete <key> [-g]
```

### 状态管理 (`ctx.state`)
```bash
ac state list [prefix] [-i "<regex>"] [--json]
ac state get <key> [--json]
ac state set <key> <json-value> [--ttl <seconds>]
ac state delete <key>
```

### 执行历史与任务取消 (Runs)
```bash
ac runs list [patterns...] [-i "<regex>"] [--action <id>] [--limit 20] [--json]
ac runs show <run-id> [--json]
ac runs show <run-id> --profile <profile-name> [--json]       # 查询远程运行详情
ac runs cancel <run-id> --profile <profile-name> [--json]     # 取消远端运行中的任务
```

---

## 8. 单元测试 Action

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
```

---

## 9. 构建与 Skill 导出

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

# 工具驱动按需导出：仅打包指定 Actions，并自动裁剪依赖未包含 Action 的 Playbooks
ac export skill --actions github.get-pr github.review-pr
```

导出的 Skill 目录结构：
```text
dist/<package>-skill/
├── SKILL.md                  # 面向 AI Agent 的调用说明（自动生成 Action 与 Playbook 索引）
├── actiondock.skill.json     # 机器可读的 Skill 清单
├── playbooks/                # 任务 SOP Markdown 引导文档（按需打包时仅含匹配的 SOP）
└── bin/
    └── <package>             # 零安装独立可执行文件（仅含已打包 Action）
```

---

## 10. Agent 开发核心红线

1. **通道隔离原则**：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至 `stderr`），确保 `stdout` 仅输出标准 JSON Envelope。
2. **严格 Schema 原则**：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`。
3. **响应式取消原则**：对于网络 I/O 与耗时循环，始终绑定并检测 `ctx.signal`。
