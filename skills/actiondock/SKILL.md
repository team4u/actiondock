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

    // Action 组合: 跨 Action 组合调用（具备自动循环调用检测与父子 Run 关联）
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

# 完整子命令方式 (ac action run)
ac action run <id> -i '{"repo": "owner/repo"}'
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

---

## 多环境与远程云机器调度 (Profiles & Serve)

### 1. 远端云机器启动 HTTP Runner
在云端主机上启动微型监听服务：
```bash
ac serve [--port 5177] [--host 0.0.0.0] [--token <secret-token>]
```

### 2. 本地管理 Profile
```bash
# 添加云节点
ac profile add aliyun-prod --server http://1.2.3.4:5177 --token secret123 --desc "阿里云生产节点"

# 列出所有已配置的 profile
ac profile list [--json]

# 测试云节点连通性与延迟
ac profile test aliyun-prod

# 切换全局默认 profile
ac profile use aliyun-prod

# 查看或删除 profile
ac profile show [name] [--json]
ac profile rm <name>
```

### 3. 调度远端 Action 执行
```bash
# 通过 --profile 调度
ac run check-disk --profile aliyun-prod -i '{"mount": "/data"}'

# 直接传 server 地址调度
ac run check-disk --server http://1.2.3.4:5177 --token secret123
```

---

## Playbook 任务 SOP 指南

Playbook（`playbooks/*.md`）为 AI Agent 提供领域任务的逐步操作规程（SOP）：

### 创建 Playbook
```bash
ac playbook create <id> --desc "SOP 任务描述" --actions action-a action-b
```

### 检查与校验 Playbook
```bash
ac playbook list [patterns...] [-i "<regex>"] [--json]
ac playbook show <id> [--json]
ac playbook validate
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

### 执行历史
```bash
ac runs list [patterns...] [-i "<regex>"] [--action <id>] [--limit 20] [--json]
ac runs show <run-id> [--json]
```


---

## 单元测试 Action

使用 `@actiondock/sdk` 提供的 `createTestRuntime` 内存测试运行时：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import myAction from "../actions/my-action";

describe("my-action", () => {
  it("使用 Mock 配置与状态正常执行", async () => {
    const runtime = createTestRuntime({
      config: { GITHUB_TOKEN: "mock-token" },
      state: { last_sync: "2026-01-01" },
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

### 构建独立可执行文件
```bash
ac build [--target <target>] [--out <path>] [--minify]
```

### 导出完整 Skill 交付包
```bash
ac export skill [--target <target>] [--out <path>] [--archive]
```

生成的 Skill 目录结构：
```text
dist/<package>-skill/
├── SKILL.md                  # 面向 AI Agent 的调用说明
├── actiondock.skill.json     # 机器可读的 Skill 清单
├── playbooks/                # 任务 SOP Markdown 引导文档
└── bin/
    └── <package>             # 零安装独立可执行文件
```
