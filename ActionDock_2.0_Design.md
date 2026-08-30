#

> 基于 Bun + TypeScript 的极简重写方案\
> 状态：Architecture Draft / 可作为重写起点\
> 日期：2026-08-30

***

## 1. 摘要

ActionDock 2.0 不再以“必须安装并运行一个 ActionDock Server 的脚本平台”为中心，而重新定义为：

> **面向 AI Agent Action 的开发、调试、构建与分发工具链。**

作者在本地使用 ActionDock CLI 编写和调试 Action、Playbook、Config 与 Shared State；发布时由 ActionDock 将一组 Action 及其依赖编译为自包含的 standalone executable，并与 `SKILL.md` 一起组成可直接分发的 Skill。

最终消费者不需要安装 ActionDock、Bun、Node、Python、Java，也不需要运行后台服务。

核心链路：

```text
Author
  │
  ▼
ActionDock CLI
  │
  ├── develop Actions
  ├── test Actions
  ├── manage Config
  ├── inspect Shared State
  ├── author Playbooks
  └── build / export
  │
  ▼
Standalone Skill Artifact
  │
  ├── SKILL.md
  └── bin/<package executable>
  │
  ▼
AI Agent / End User

No ActionDock installation
No Bun installation
No daemon
No server
```

V1 的技术核心是：

```text
Language       TypeScript
Runtime        Bun
CLI            Bun + TypeScript
Package manager Bun
Bundler        Bun.build
Standalone     Bun compile
Local storage  bun:sqlite
Playbook       Markdown
Schema         JSON Schema
```

V1 明确不做 Web UI、Server、插件系统、内置 AI、Agent Runtime、MCP、权限沙箱和通用 Skill Management。

***

# 2. 产品重新定位

## 2.1 ActionDock 不应该成为最终用户依赖

旧模型的问题：

```text
Skill
  │
  ▼
ActionDock CLI / Server
  │
  ▼
Script Runtime
```

最终用户必须先理解并安装 ActionDock，产生额外认知和运维成本。

新模型：

```text
                 ActionDock

          Authoring / Build Tool
                   │
                   ▼
             Action Package
                   │
                   ▼
        Standalone Skill Artifact
                   │
                   ▼
                 User
```

ActionDock 的复杂度全部留在作者侧。

最终用户面对的应该只是：

```text
一个 Skill
+
一个可执行文件
```

***

## 2.2 ActionDock 的核心价值

如果最终形态只是：

```text
TypeScript/Python + Skill + 额外安装 ActionDock
```

那么 ActionDock 很难证明自身必要性。

ActionDock 2.0 的价值应该是完整的 Action 工程化链路：

```text
Write
  ↓
Run
  ↓
Debug
  ↓
Config
  ↓
Shared State
  ↓
Compose
  ↓
Test
  ↓
Build
  ↓
Package
  ↓
Export Skill
  ↓
Distribute
```

最终消费者仍然获得极简体验。

***

# 3. 设计原则

## 3.1 零安装消费

Standalone Artifact 的目标机器不要求预装：

* ActionDock
* Bun
* Node.js
* Python
* Java

Artifact 自带执行所需 runtime。

***

## 3.2 CLI First

V1 作者功能全部通过 CLI 完成。

不建设：

```text
Web Server
REST API
Web UI
WebSocket
ORM
用户系统
多租户
后台管理
```

只有当真实作者体验明确证明 UI 能显著改善效率时，再增加 UI。

未来 UI 也只能是 Core 的另一个 frontend：

```text
             ActionDock Core
                  │
          ┌───────┴───────┐
          ▼               ▼
         CLI              UI
```

绝不能重新演化成 Server-centric 架构。

***

## 3.3 Filesystem First

Action、Playbook、Project Definition 均以普通文件为事实来源。

数据库不保存源代码定义。

```text
Git repository
     =
ActionDock Project
```

这样天然获得：

* Git version control
* diff/review
* branch
* merge
* CI
* IDE support
* LLM editing

***

## 3.4 SQLite 只保存运行态数据

SQLite 只用于真正适合 KV/查询的数据：

* Config values
* Shared State
* Run records

不使用 ORM。

不引入重量级 migration framework。

V1 可直接通过 `PRAGMA user_version` 管理极少量 schema migration。

***

## 3.5 平台语言与 Action 语言统一

统一为 TypeScript：

```text
CLI         TypeScript
Builder     TypeScript
Runtime     TypeScript
Action      TypeScript
Tests       TypeScript
```

Bun 同时提供：

```text
Runtime
Package Manager
Bundler
Test Runner
Standalone Compiler
SQLite Driver
```

避免重新形成 Java + Groovy + Python + Node + PF4J + Maven + pip + venv 的多技术栈组合。

***

## 3.6 尽可能使用语言生态，不重新造框架

HTTP：

```ts
fetch()
```

Shell：

```ts
Bun.spawn()
```

File：

```ts
Bun.file()
```

第三方 SDK：

```bash
bun add <package>
```

ActionDock 不包装这些 API。

只有 ActionDock 必须掌握领域语义的能力才进入 Runtime Context：

```ts
ctx.config
ctx.state
ctx.actions
ctx.log
```

***

## 3.7 开发态与交付态语义一致

最重要的不变量：

> **在 `actiondock run` 中调通的 Action，在 standalone artifact 中必须继续使用同一套 ActionContext 和行为模型。**

即：

```text
Development
-----------
Action
  ├── ctx.config
  ├── ctx.state
  ├── ctx.actions
  └── ctx.log

             build
               │
               ▼

Standalone
----------
Action
  ├── ctx.config
  ├── ctx.state
  ├── ctx.actions
  └── ctx.log
```

Build 不能偷偷切换成另一套运行时语义。

***

# 4. 核心领域模型

V1 只保留八个一级概念：

```text
Project
Action
Playbook
Config
Shared State
Run
Build
Artifact
```

Skill 是 Artifact 的一种交付格式，不是运行时领域对象。

***

## 4.1 Project

Project 是 ActionDock 的作者工作区，也是 Git repository 的自然边界。

```text
my-project/
├── actiondock.json
├── package.json
├── bun.lock
├── actions/
├── playbooks/
├── tests/
└── .actiondock/
```

职责：

* Project identity
* package metadata
* Action discovery root
* Playbook discovery root
* build configuration
* local runtime data location

Project 不需要数据库记录。

***

## 4.2 Action

Action 是唯一可执行领域原语。

旧版 `Script` 在 2.0 中统一重命名为 `Action`。

Action 的目标不是表达 workflow，而是提供一个稳定、可发现、可组合的 executable primitive。

最小定义：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "github.list-prs",
  description: "List pull requests for a GitHub repository",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string" }
    },
    required: ["repo"]
  },

  outputSchema: {
    type: "array"
  },

  async run(input, ctx) {
    const token = ctx.config.get<string>("GITHUB_TOKEN");

    const response = await fetch(
      `https://api.github.com/repos/${input.repo}/pulls`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );

    return await response.json();
  }
});
```

V1 ActionDefinition：

```ts
interface ActionDefinition<I = unknown, O = unknown> {
  id: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  run(input: I, ctx: ActionContext): Promise<O> | O;
}
```

刻意不加入：

```text
PluginDependency
AiDependency
PythonRequirements
RepositoryScope
PublishedRevision aggregate
Permission DSL
Workflow Step
DAG Edge
Expression
Condition
```

***

## 4.3 Playbook

Playbook 保持极简，并延续原有正确语义：

> **Playbook 是给 LLM 阅读的任务 SOP / domain Skill，不是 ActionDock 执行的 workflow。**

```text
Playbook
   │
   ▼
LLM understands task
   │
   ▼
LLM chooses Actions
   │
   ▼
Standalone executable
```

Playbook 是 Markdown：

```text
playbooks/
└── review-pr.md
```

可使用极少 frontmatter：

```md
---
id: review-pr
description: Review a pull request and produce findings
actions:
  - github.get-pr
  - github.get-diff
  - github.comment-pr
---

# Review Pull Request

先获取 PR 信息和 diff。

重点检查行为变化、边界条件以及可能的回归。

除非用户明确要求，否则不要自动 merge。
```

其中 `actions` 只是候选工具提示，不是执行顺序。

明确禁止：

```text
steps:
edges:
if:
foreach:
parallel:
expression:
```

ActionDock 不执行 Playbook。

不存在：

```bash
actiondock playbook run
```

***

## 4.4 Config

Config 是运行时基础设施，V1 必须保留。

Action 必须通过统一接口访问配置：

```ts
ctx.config.get("GITHUB_TOKEN")
ctx.config.get("GITHUB_API", "https://api.github.com")
```

不鼓励 Action 直接依赖：

```ts
process.env.GITHUB_TOKEN
```

原因不是安全，而是可移植性。

同一个 Action 在开发态与 standalone 中可以使用不同 Config Provider，而代码不变。

接口：

```ts
interface Config {
  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  has(key: string): boolean;
}
```

V1 配置来源优先级：

```text
1. run/build command 临时 override
2. standalone / project local config store
3. project defaults
```

环境变量映射可以作为后续便利功能加入，但不应成为 Config 模型本身。

Project 中可以声明默认值和文档：

```json
{
  "config": {
    "GITHUB_API": {
      "description": "GitHub API endpoint",
      "default": "https://api.github.com"
    },
    "GITHUB_TOKEN": {
      "description": "GitHub access token"
    }
  }
}
```

实际值不写入 `actiondock.json`。

CLI：

```bash
actiondock config list
actiondock config get GITHUB_TOKEN
actiondock config set GITHUB_TOKEN xxx
actiondock config delete GITHUB_TOKEN
```

***

## 4.5 Shared State

Shared State 是另一个必须存在的 Runtime primitive。

典型用途：

* checkpoint
* last sync cursor
* 去重
* 小型缓存
* token refresh metadata
* 多 Action 共享中间状态
* 增量同步位置

API：

```ts
interface StateStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  scope(namespace: string): StateStore;
}
```

Action：

```ts
const cursor = await ctx.state.get<string>("sync:cursor");

// ...

await ctx.state.set("sync:cursor", nextCursor);
```

### Namespace

State 至少必须有 package namespace。

物理 key：

```text
<package-id>:<state-key>
```

例如：

```text
team4u.github:sync:cursor
team4u.github:last-pr
```

`scope()` 只提供便利的 namespace 前缀，不建设复杂 State hierarchy。

***

## 4.6 Run

Run 只表示实际 Action execution。

不存在：

```text
PlaybookRun
StepRun
AgentRun
```

Run：

```ts
interface RunRecord {
  id: string;
  actionId: string;
  parentRunId?: string;
  status: "running" | "success" | "failed";
  input: unknown;
  output?: unknown;
  error?: RuntimeError;
  startedAt: string;
  finishedAt?: string;
}
```

`parentRunId` 用于表示 Action 调 Action：

```text
Run A
  │
  ├── Run B
  │     └── Run C
  │
  └── Run D
```

不单独建 Execution Graph Domain。

Run tree 是 execution fact 自然形成的结果。

***

## 4.7 Build

Build 是从源 Project 生成可交付程序的过程。

```text
Project
  │
  ├── Actions
  ├── Playbooks
  ├── npm dependencies
  ├── package metadata
  └── bun.lock
  │
  ▼
Build
  │
  ├── discover selected actions
  ├── generate registry entrypoint
  ├── resolve code dependency graph
  ├── validate schemas
  ├── bundle
  └── compile standalone executable
```

Build 是过程，不需要成为复杂数据库对象。

***

## 4.8 Artifact

Artifact 是 Build 的不可变结果。

Artifact identity：

```text
package id
package version
target platform
build hash
```

示例：

```text
github-tools@1.2.0-darwin-arm64.zip
github-tools@1.2.0-linux-x64.zip
github-tools@1.2.0-windows-x64.zip
```

***

# 5. Action Runtime

## 5.1 ActionContext

V1 Runtime Context 只保留四个能力：

```ts
interface ActionContext {
  config: Config;
  state: StateStore;
  actions: ActionInvoker;
  log: Logger;
}
```

这四个能力具有 ActionDock 特有的领域价值。

不加入：

```ts
ctx.http
ctx.fs
ctx.shell
ctx.database
```

因为 Bun / Web Platform 已经直接提供这些能力。

***

## 5.2 Action 调 Action

组合能力必须保留，但尽量使用 TypeScript 自己的 import graph，而不是再维护一套字符串依赖 DSL。

推荐：

```ts
import { defineAction } from "@actiondock/sdk";
import getPr from "./get-pr";

export default defineAction({
  id: "github.review-pr",

  async run(input, ctx) {
    const pr = await ctx.actions.invoke(getPr, {
      id: input.id
    });

    return review(pr);
  }
});
```

接口：

```ts
interface ActionInvoker {
  invoke<I, O>(
    action: ActionDefinition<I, O>,
    input: I
  ): Promise<O>;
}
```

优点：

1. 依赖就是普通 TS import。
2. Bun bundler 自然获得 code dependency closure。
3. 不需要额外维护 `ScriptDependency[]`。
4. IDE/TypeScript 能直接提供类型检查。
5. ActionDock 仍能通过 `invoke()` 创建 child Run、日志关联和循环调用检测。

运行时维护 action call stack：

```text
github.review-pr
  ↓
github.get-pr
  ↓
github.review-pr   ← cycle
```

检测到重复 action id 后直接失败。

***

## 5.3 Action Registry

开发态：ActionDock 扫描 `actions/**/*.ts`。

构建态：Builder 生成静态 registry：

```ts
import a0 from "../actions/list-prs";
import a1 from "../actions/get-pr";
import a2 from "../actions/review-pr";

export const registry = new Map([
  [a0.id, a0],
  [a1.id, a1],
  [a2.id, a2]
]);
```

Standalone binary 不做目录扫描。

所有入口在构建时被冻结。

这使 Bundler 可以完整分析依赖关系。

***

# 6. Runtime Storage

## 6.1 为什么 V1 应该保留 SQLite

虽然 Project Source 使用文件系统，但 Config / State / Run 天然适合本地数据库。

Bun 已内置 `bun:sqlite`，因此不需要额外 native dependency、ORM 或数据库服务。

推荐：

```text
.actiondock/
└── runtime.db
```

***

## 6.2 最小表结构

### config

```sql
CREATE TABLE config (
  package_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, key)
);
```

### state

```sql
CREATE TABLE state (
  package_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, namespace, key)
);
```

### runs

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  parent_run_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
```

V1 不需要 ORM model。

SQL 直接放在 storage module 中。

***

## 6.3 Standalone 数据目录

Standalone Skill 不应该依赖安装目录可写。

默认数据位置建议：

```text
~/.actiondock/data/<package-id>/runtime.db
```

注意：这只是数据目录约定，不代表用户安装了 ActionDock。

二进制允许：

```bash
./github-tools --data-dir /custom/path ...
```

因此：

```text
Skill installation
    ≠
Runtime state location
```

Skill 升级或替换不会删除 State。

***

# 7. Project Format

推荐目录：

```text
github-tools/
├── actiondock.json
├── package.json
├── bun.lock
├── actions/
│   ├── list-prs.ts
│   ├── get-pr.ts
│   ├── review-pr.ts
│   └── comment-pr.ts
├── playbooks/
│   └── review-pr.md
├── tests/
│   ├── list-prs.test.ts
│   └── review-pr.test.ts
└── .actiondock/
    └── runtime.db
```

`.actiondock/` 加入 `.gitignore`。

***

## 7.1 actiondock.json

V1 保持非常小：

```json
{
  "id": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "0.1.0",
  "description": "GitHub actions for AI agents",
  "actionsDir": "actions",
  "playbooksDir": "playbooks",
  "config": {
    "GITHUB_API": {
      "default": "https://api.github.com"
    },
    "GITHUB_TOKEN": {
      "description": "GitHub token"
    }
  }
}
```

不要让 manifest 逐渐吸收所有运行时细节。

package dependency 继续归 `package.json` 和 `bun.lock` 管。

***

# 8. CLI Design

## 8.1 CLI 原则

CLI 是 V1 唯一作者界面。

所有命令必须：

* scriptable
* predictable
* Agent-friendly
* stdout/stderr 语义稳定
* exit code 稳定

原则：

```text
stdout = machine-consumable result
stderr = log / diagnostics
exit 0 = success
exit non-zero = failure
```

管理类命令默认可读文本，但统一支持 `--json`。

`run` 默认输出标准 JSON envelope。

***

## 8.2 V1 Commands

### Project

```bash
actiondock init [name]
actiondock info
```

### Action

```bash
actiondock action list
actiondock action show <id>
actiondock action validate [id]
actiondock run <id> --input '<json>'
actiondock test [id]
```

### Playbook

```bash
actiondock playbook list
actiondock playbook show <id>
actiondock playbook validate [id]
```

不存在：

```bash
actiondock playbook run
```

### Config

```bash
actiondock config list
actiondock config get <key>
actiondock config set <key> <value>
actiondock config delete <key>
```

### State

```bash
actiondock state list [prefix]
actiondock state get <key>
actiondock state set <key> '<json>'
actiondock state delete <key>
```

### Run

```bash
actiondock run list
actiondock run show <run-id>
```

如果 `run` 作为执行命令会和子命令冲突，则建议正式命令定为：

```bash
actiondock action run <id>
actiondock runs list
actiondock runs show <id>
```

最终推荐后者，语义更稳定。

### Build / Export

```bash
actiondock build
actiondock build --target darwin-arm64
actiondock export skill
actiondock export skill --target linux-x64
```

***

# 9. Run Protocol

## 9.1 输入

开发态：

```bash
actiondock action run github.list-prs \
  --input '{"repo":"team4u/actiondock"}'
```

也支持：

```bash
actiondock action run github.list-prs --input-file input.json
```

***

## 9.2 输出

成功：

```json
{
  "ok": true,
  "runId": "01J...",
  "data": {
    "items": []
  }
}
```

失败：

```json
{
  "ok": false,
  "runId": "01J...",
  "error": {
    "code": "ACTION_FAILED",
    "message": "GitHub returned 403"
  }
}
```

日志写 stderr，而不是污染 stdout JSON。

这种协议同时用于 standalone binary。

***

# 10. Build System

## 10.1 核心目标

Build 的本质是：

> **把动态作者 Project 冻结为一个静态、可独立执行的 Package Runtime。**

流程：

```text
Project
  │
  ▼
Discover actions
  │
  ▼
Validate metadata / schemas
  │
  ▼
Select entry actions
  │
  ▼
Generate static action registry
  │
  ▼
Generate standalone CLI entrypoint
  │
  ▼
Bun.build
  │
  ├── bundle TS
  ├── bundle npm dependencies
  ├── tree-shake reachable code
  └── compile Bun runtime
  │
  ▼
Executable
```

Bun 当前提供 `Bun.build({ compile: ... })` 的 standalone executable 能力，并支持指定目标平台进行构建，因此它可以直接作为 V1 的 build backend。

***

## 10.2 一个 Package 一个 executable

不要：

```text
Action A -> executable A
Action B -> executable B
Action C -> executable C
```

否则每个 executable 都会重复携带 Runtime。

应该：

```text
Package
├── Action A
├── Action B
└── Action C
       │
       ▼
one package executable
```

例如：

```bash
./github-tools list
./github-tools describe github.list-prs
./github-tools run github.list-prs --input '{...}'
```

这样一个 Skill 只携带一份 Bun runtime。

***

## 10.3 Standalone Generated Entrypoint

概念代码：

```ts
import { createStandaloneRuntime } from "@actiondock/runtime";
import listPrs from "./actions/list-prs";
import getPr from "./actions/get-pr";
import reviewPr from "./actions/review-pr";

const app = createStandaloneRuntime({
  packageId: "team4u.github-tools",
  version: "0.1.0",
  actions: [
    listPrs,
    getPr,
    reviewPr
  ]
});

await app.run(Bun.argv.slice(2));
```

该文件由 Builder 临时生成，不进入用户源代码。

***

## 10.4 Dependency Strategy

分成两类依赖：

### Code dependency

```ts
import { Octokit } from "@octokit/rest";
```

交给：

```text
package.json
bun.lock
Bun bundler
```

ActionDock 不维护第二套 dependency metadata。

### Action dependency

通过 TypeScript import + `ctx.actions.invoke()` 表达。

同样由代码 module graph 自然闭包。

因此 V1 不需要：

```text
ActionDependency[] manifest
PluginDependency[]
RuntimeDependency[]
```

***

## 10.5 Portable 与 Native Dependency

V1 建议正式支持一个主 profile：

```text
portable
```

目标：

* TypeScript / JavaScript
* Bun built-ins
* 普通 npm packages
* 不依赖外部 runtime

使用 Node-API addon、FFI、平台 native binary 的 package 可以继续运行，但 Build 标记为：

```text
native-dependent
```

这种 artifact 必须按目标平台构建和验证。

不要为了支持所有 npm package 而自己建设 native dependency manager。

***

# 11. Standalone Package Protocol

Standalone binary 本身也是 Agent-friendly CLI。

统一协议：

```bash
./github-tools list --json
./github-tools describe github.list-prs --json
./github-tools run github.list-prs --input '{...}'
```

可选维护命令：

```bash
./github-tools config list
./github-tools config set GITHUB_TOKEN xxx
./github-tools state list
```

因此生成的 Skill 不需要知道 ActionDock CLI。

它只需要知道自己附带的 executable。

***

# 12. Skill Export

## 12.1 Skill 是交付层，不是 Runtime

Skill：

```text
LLM instructions
+
standalone executable
```

例如：

```text
github-tools/
├── SKILL.md
├── actiondock.skill.json
└── bin/
    └── github-tools
```

***

## 12.2 平台 artifact

不建议默认把所有平台二进制一起塞入一个 Skill，因为 Bun runtime 会使包体积重复。

默认按 target 输出：

```text
github-tools-skill-darwin-arm64.zip
github-tools-skill-darwin-x64.zip
github-tools-skill-linux-x64.zip
github-tools-skill-windows-x64.zip
```

Registry / installer 将来负责选择目标平台。

内部早期可以人工选择并解压对应 artifact。

***

## 12.3 SKILL.md

ActionDock 为项目生成基础 Skill，也允许作者提供自定义内容。

Skill 主要告诉 LLM：

1. 这个 Package 能做什么。
2. 如何发现 Action。
3. 如何查看输入输出 Schema。
4. 如何调用 Action。
5. 哪些 Playbook 可作为任务 SOP。

示意：

```md
# GitHub Tools

Use `./bin/github-tools` to perform GitHub operations.

Discover actions:

    ./bin/github-tools list --json

Inspect an action:

    ./bin/github-tools describe github.list-prs --json

Execute:

    ./bin/github-tools run github.list-prs --input '{"repo":"owner/repo"}'

The command writes structured JSON to stdout.
```

如果项目有 Playbook，可把 Markdown 一同放入 Skill 包：

```text
playbooks/
└── review-pr.md
```

LLM 阅读 Playbook，然后自行选择 Action。

***

# 13. Config / State 在 Standalone 中的行为

这是整个 2.0 架构必须保证的一致性点。

## 13.1 Config

开发态：

```text
.actiondock/runtime.db
```

Standalone：

```text
~/.actiondock/data/<package-id>/runtime.db
```

Action 看见的都只是：

```ts
ctx.config
```

***

## 13.2 State

开发态和 standalone 都使用 SQLite StateStore。

因此：

```ts
await ctx.state.set("cursor", cursor)
```

不因为打包而改变语义。

***

## 13.3 Data migration

Package version 升级不删除 runtime.db。

如果未来需要 State schema migration，应由 Action package 自己显式实现，而不是 ActionDock 猜测数据结构。

V1 Shared State 只是 JSON KV，不提供业务 schema migration abstraction。

***

# 14. Testing

## 14.1 普通单元测试

直接使用 Bun test runner：

```ts
import { test, expect } from "bun:test";
```

Action 本身是普通 TypeScript，因此纯业务逻辑无需经过 ActionDock。

***

## 14.2 Action Runtime Test

ActionDock SDK 提供 test runtime：

```ts
const runtime = createTestRuntime({
  config: {
    GITHUB_TOKEN: "test-token"
  },
  state: {
    "sync:cursor": "123"
  }
});

const result = await runtime.run(myAction, input);
```

Test Runtime 使用临时 SQLite 或 memory storage。

***

## 14.3 Build Contract Test

必须有一类测试验证：

```text
actiondock run
      ==
compiled artifact run
```

至少覆盖：

* config behavior
* state persistence
* nested action invoke
* JSON protocol
* error handling

这是保证“开发态 = 交付态”的关键回归测试。

***

# 15. Error Model

统一错误结构：

```ts
interface RuntimeError {
  code: string;
  message: string;
  details?: unknown;
  cause?: unknown;
}
```

基础 code：

```text
ACTION_NOT_FOUND
INPUT_VALIDATION_FAILED
OUTPUT_VALIDATION_FAILED
ACTION_FAILED
ACTION_CYCLE_DETECTED
CONFIG_NOT_FOUND
BUILD_FAILED
```

不要为每一个 feature 建大量 Exception class。

TypeScript 使用少量 typed error 即可。

***

# 16. Logging

接口：

```ts
interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}
```

开发态：

* 输出到 stderr
* 可关联 Run ID

Standalone：

* 同样输出 stderr
* 最终 JSON 永远保留 stdout

V1 可以不持久化完整日志；Run 表只保存最终 input/output/error。

如果后续真实需要日志检索，再加入 `run_logs`。

***

# 17. JSON Schema

Action 的 `inputSchema` 与 `outputSchema` 使用标准 JSON Schema。

目标：

```text
同一份 schema
   │
   ├── CLI describe
   ├── input validation
   ├── output validation
   ├── Skill / Agent discovery
   └── future UI form
```

不要维护自定义“部分兼容 JSON Schema”的验证器。

直接选择成熟 JSON Schema package。

ActionDock 的职责是调用标准 validator，不是实现 schema language。

***

# 18. Repository / Distribution

V1 不建设中心化 Repository Server。

首先证明：

```text
Project
  ↓
Build
  ↓
Standalone Skill
  ↓
其他人直接使用
```

V1 可通过：

* Git repository
* GitHub Release
* 内部文件服务器
* 对象存储

进行 Artifact 分发。

***

## 18.1 后续 Registry 模型

如果内部验证成功，再增加独立 Distribution Service：

```text
ActionDock Registry
      │
      ├── package metadata
      ├── versions
      ├── artifacts
      ├── target platforms
      ├── checksums
      └── download
```

注意：Registry 只管理 Package/Artifact。

它不应该重新进入 Action Runtime Core。

```text
Runtime Core
     ↑
     │ no dependency
     │
Registry
```

***

# 19. Optional Host：Schedule / Webhook

Schedule 和 Webhook 仍然有价值，但不应该阻碍“零安装 Artifact”主线。

V1 不做。

未来作为可选 Host：

```text
             Action Package
                  ▲
                  │
          ┌───────┴───────┐
          │               │
       Webhook          Schedule
          │               │
          └────── Host ────┘
```

原则仍然保持：

```text
Webhook -> Action
Schedule -> Action
```

不是：

```text
Webhook -> Playbook
Schedule -> Playbook
```

Playbook 仍然只给 LLM 阅读。

Host 可以是：

```bash
actiondock host
```

也可以是未来独立 package。

不要求普通 Skill 消费者运行 Host。

***

# 20. 不建设内置 AI / Agent Runtime

ActionDock 2.0 继续坚持：

> **ActionDock 不需要知道 LLM；LLM 只需要知道如何使用 ActionDock Artifact。**

因此不做：

```text
LLM provider abstraction
Agent loop
Prompt orchestration
Model gateway
Agent execution domain
Agent run records
MCP server
```

最终：

```text
LLM
 │
 ▼
SKILL.md
 │
 ▼
Standalone CLI
 │
 ▼
Action
```

***

# 21. 不建设 Plugin System

V1 没有 Plugin 概念。

扩展普通功能：

```bash
bun add package
```

然后：

```ts
import xxx from "package";
```

即可。

如果某个能力应该被多个 Action 项目复用，则发布普通 npm package。

只有未来真实出现“运行时动态安装长期生命周期组件”的需求，才重新评估 Plugin System。

不要预先建设：

```text
PF4J equivalent
Knotra integration
Component lifecycle
Capability registry
Hot reload generation system
```

***

# 22. Knotra 的处理

由于 2.0 允许完全重写，Knotra 不作为默认依赖。

判断原则：

> **只有当 ActionDock 2.0 出现 Bun 本身无法自然解决、且 Knotra 能显著删除代码的长期 runtime lifecycle 问题时，才重新引入。**

现阶段：

```text
ActionDock Domain
-----------------
Action
Playbook
Config
State
Run
Build
Artifact

Runtime / Build Infrastructure
------------------------------
Bun
```

已经足够。

***

# 23. 为什么选择 Bun

在当前前提下：

```text
内部可信环境
暂不考虑权限隔离
暂不执行不可信第三方代码
```

Bun 比 Deno 更适合作为第一主线。

主要原因：

1. TypeScript 直接运行。
2. Runtime / package manager / bundler / test / compile 一体化。
3. npm 与 Node ecosystem 兼容度高。
4. `Bun.build` 天然适合从 Action Project 生成 bundle。
5. `compile` 能直接生成 standalone executable。
6. 支持指定 target 生成不同平台 executable。
7. `bun:sqlite` 足够承载 Config / Shared State / Run。
8. 平台代码与 Action 代码统一使用 TypeScript。

***

## 23.1 为什么不是 Java

Java 能实现 standalone bundle，甚至可以使用 GraalVM Native Image。

但对于一个允许重写、且核心是“开发和分发脚本型 Action”的项目，Java 需要承担更多：

```text
JVM
Script Engine
Dynamic compilation
Packaging
Native-image constraints
Reflection metadata
Plugin/runtime infrastructure
```

而 Bun 更接近产品本身所需的原生形态。

***

## 23.2 为什么不是 Python

Python 极适合脚本作者，但平台层会出现：

```text
Python runtime
venv
pip
native wheels
PyInstaller
platform build matrix
```

并且 CLI / Builder / Frontend tooling 仍可能引入其他语言。

Bun 让整条链更统一。

***

## 23.3 为什么现在不选 Rust

Rust 非常适合构建小型 native executable，但如果 Action 仍希望使用动态、易生成、生态丰富的脚本语言，就需要：

```text
Rust host
+
JS/TS runtime
+
module loader
+
package manager
+
HTTP
+
debugging
+
source map
+
bundler
```

本质是在重新实现 Bun/Deno。

Rust 更适合作为未来少量 native capability 或性能模块，而不是 V1 主运行时。

***

## 23.4 WASM 的未来位置

WASM Component Model 值得长期关注，但 V1 不作为核心运行时。

未来可能：

```text
                ActionDock Host
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
         Bun        WASM      Native
       Actions    Components   Modules
```

只有当：

* 第三方不可信代码
* 强沙箱
* 多语言 component
* 跨语言 ABI

真正成为产品要求时再引入。

***

# 24. 源代码模块建议

不要一开始拆十几个 package。

V1 推荐：

```text
actiondock/
├── packages/
│   ├── sdk/
│   │   └── defineAction + public types
│   └── cli/
│       ├── cli/
│       ├── project/
│       ├── action/
│       ├── playbook/
│       ├── runtime/
│       ├── storage/
│       ├── build/
│       └── export/
└── examples/
```

只公开两个 package 概念：

```text
@actiondock/sdk
@actiondock/cli (or actiondock executable)
```

甚至 CLI package 可以只发布 executable，不要求普通 Action 依赖。

避免早期形成：

```text
core-api
core-impl
runtime-api
runtime-core
storage-api
storage-sqlite
builder-api
builder-core
...
```

只有出现真实替换边界时再拆。

***

# 25. SDK Boundary

`@actiondock/sdk` 应非常小。

建议只包括：

```ts
export {
  defineAction,
  type ActionDefinition,
  type ActionContext,
  type Config,
  type StateStore,
  type ActionInvoker,
  type Logger
};
```

目标：

> Action 项目即使长期不升级 ActionDock CLI，也不会因为庞大 SDK 而被强耦合。

SDK 尽量以 types + 小型 helper 为主。

***

# 26. Build Metadata

每个 Artifact 生成 `artifact.json`：

```json
{
  "packageId": "team4u.github-tools",
  "version": "0.1.0",
  "target": "darwin-arm64",
  "actions": [
    "github.list-prs",
    "github.get-pr",
    "github.review-pr"
  ],
  "bunVersion": "...",
  "lockHash": "...",
  "buildHash": "..."
}
```

用于：

* 调试
* 版本确认
* Registry metadata
* artifact reproducibility 分析

不把它建设成运行时复杂 domain object。

***

# 27. Versioning

Package version 采用 SemVer。

Action 不单独维护独立版本。

```text
Package version
    owns
all bundled Action versions
```

这样避免：

```text
Package 1.2.0
Action A 3.1.4
Action B 8.0.2
Playbook X 2.4.1
```

的版本组合爆炸。

Artifact 的 immutable unit 就是 Package version。

***

# 28. 发布模型

作者：

```bash
actiondock build --target darwin-arm64
actiondock export skill --target darwin-arm64
```

未来：

```bash
actiondock publish
```

概念：

```text
Project
  │
  ▼
Package Version
  │
  ├── source metadata
  ├── playbooks
  └── artifacts
        ├── darwin-arm64
        ├── darwin-x64
        ├── linux-x64
        └── windows-x64
```

Registry 可以负责 target selection。

***

# 29. CI Build

推荐构建矩阵：

```text
lint
  ↓
test
  ↓
actiondock validate
  ↓
build targets
  ↓
artifact contract test
  ↓
publish artifacts
```

即使 Bun 可以 cross-compile，也建议重要平台最终在对应 OS CI 上执行 smoke test。

原因不是 Bun 本身，而是 npm package 可能存在平台行为差异。

***

# 30. V1 明确不做什么

这是重写成功的关键约束。

V1 不做：

| 能力                       | 决策    |
| :----------------------- | :---- |
| Web UI                   | 不做    |
| Server                   | 不做    |
| REST API                 | 不做    |
| 用户/权限                    | 不做    |
| 沙箱                       | 不做    |
| MCP                      | 不做    |
| 内置 LLM                   | 不做    |
| Agent Runtime            | 不做    |
| Plugin System            | 不做    |
| Knotra Integration       | 不做    |
| Python Runtime           | 不做    |
| Java/Groovy Runtime      | 不做    |
| WASM Runtime             | 不做    |
| Repository Server        | 不做    |
| Generic Skill Management | 不做    |
| Workflow Engine          | 不做    |
| DAG / Step DSL           | 不做    |
| Playbook Execution       | 不做    |
| Schedule                 | V1 不做 |
| Webhook                  | V1 不做 |
| ORM                      | 不做    |
| 多数据库                     | 不做    |

原则：

> V1 的任务不是重新实现旧 ActionDock 所有功能，而是验证新交付模型是否成立。

***

# 31. V1 必须做什么

| 能力                      |                        优先级 |
| :---------------------- | -------------------------: |
| Project                 |                         P0 |
| TypeScript Action       |                         P0 |
| Action discovery        |                         P0 |
| Action run              |                         P0 |
| Action-to-Action invoke |                         P0 |
| JSON Schema             |                         P0 |
| Config                  |                         P0 |
| Shared State            |                         P0 |
| Run record              |                         P0 |
| Markdown Playbook       |                         P0 |
| CLI                     |                         P0 |
| Bun standalone build    |                         P0 |
| Skill export            |                         P0 |
| Cross-target artifact   |                         P1 |
| Artifact metadata       |                         P1 |
| Run inspection          |                         P1 |
| Test Runtime            |                         P1 |
| Registry                |                         P2 |
| Optional Host           |                         P2 |
| UI                      | P3 / only if proven needed |

***

# 32. V1 成功标准

不要用“实现多少功能”衡量。

V1 只验证以下闭环：

### 目标 A：作者体验

从空目录开始：

```bash
actiondock init github-tools
```

作者创建 Action：

```ts
export default defineAction(...)
```

配置：

```bash
actiondock config set GITHUB_TOKEN xxx
```

调试：

```bash
actiondock action run github.list-prs \
  --input '{"repo":"team4u/actiondock"}'
```

State 可以跨多次运行保留。

***

### 目标 B：组合

Action A 可以：

```ts
await ctx.actions.invoke(actionB, input)
```

并拥有：

* child run
* config inheritance
* state sharing
* cycle detection

***

### 目标 C：零安装交付

执行：

```bash
actiondock export skill
```

得到：

```text
dist/github-tools/
├── SKILL.md
└── bin/github-tools
```

拷贝到一台：

```text
没有 ActionDock
没有 Bun
没有 Node
```

的机器上仍可以：

```bash
./bin/github-tools list --json
./bin/github-tools describe github.list-prs --json
./bin/github-tools run github.list-prs --input '{...}'
```

并且 Config / State 正常工作。

如果这个闭环成立，ActionDock 2.0 的核心假设就成立。

***

# 33. 建议开发阶段

## Phase 0 — Spike

目标：验证 Bun 技术路线，不写框架。

只做：

```text
3 个 TypeScript Actions
ctx.config
ctx.state
ctx.actions.invoke
SQLite
Bun standalone compile
```

手工生成一个 executable。

必须先验证：

```text
开发态结果
≈
compiled artifact 结果
```

***

## Phase 1 — Minimal Runtime

实现：

```text
@actiondock/sdk
defineAction
ActionContext
Config
State
ActionInvoker
Run
SQLite storage
```

没有 CLI polish。

***

## Phase 2 — CLI

实现：

```text
init
info
action list/show/run/validate
config
state
runs
playbook list/show
```

做到可完全通过 terminal 开发。

***

## Phase 3 — Builder

实现：

```text
Action discovery
static registry generation
Bun.build compile
artifact metadata
single executable per package
```

***

## Phase 4 — Skill Export

实现：

```text
SKILL.md generation
Playbook copy
binary assembly
per-target archive
```

此阶段结束即形成第一个完整可用版本。

***

## Phase 5 — Internal Distribution

只有内部已经真实使用后再做：

```text
publish
registry
install/update
artifact target selection
```

***

## Phase 6 — Optional Host

如果内部自动化确实需要：

```text
Webhook -> Action
Schedule -> Action
```

建立可选 Host。

不要把 Host 重新变成整个 ActionDock 的中心。

***

# 34. 从旧 ActionDock 到 2.0 的概念映射

| 旧能力                           | 2.0                        |
| :---------------------------- | :------------------------- |
| ScriptDefinition              | ActionDefinition           |
| Groovy Script                 | TypeScript Action          |
| Python Script                 | 不迁移，按需重写为 TS               |
| ScriptEngine                  | Bun runtime + ActionRunner |
| ScriptInvocationService       | `ctx.actions.invoke()`     |
| input/output schema           | 保留，标准 JSON Schema          |
| ConfigValue                   | Config                     |
| SharedState                   | StateStore                 |
| ExecutionRecord               | RunRecord                  |
| Playbook                      | 保留原语义，Markdown SOP         |
| Schedule                      | Future Optional Host       |
| Webhook                       | Future Optional Host       |
| AI modules                    | 删除                         |
| Agent runtime                 | 删除                         |
| MCP                           | 删除                         |
| Skill Management              | 删除，改为 Skill Export         |
| PF4J Plugin                   | 删除，优先 npm package          |
| Repository metadata in Script | 删除                         |
| Repository                    | Future Artifact Registry   |
| Spring/JPA                    | 删除                         |
| Maven modules                 | 删除                         |
| Python venv/pip management    | 删除                         |
| custom JSON Schema validator  | 删除，使用标准实现                  |

***

# 35. 关键架构判断

## 35.1 ActionDock Core 不是 Server

最终：

```text
               ActionDock

          Author Toolchain
               │
               ▼
             Project
               │
               ▼
              Build
               │
               ▼
            Artifact
```

而不是：

```text
Server
  └── database
       └── scripts
```

***

## 35.2 Artifact 是真正的一等公民

设计任何功能时都应该问：

> **它能否在没有 ActionDock Server 的 standalone artifact 中继续工作？**

如果不能，应判断它究竟是：

1. 作者工具；
2. 可选 Host 能力；
3. 不应该进入 Runtime 的管理功能。

这个问题是 2.0 最重要的架构过滤器。

***

## 35.3 Action Runtime 应极小

Runtime 只应该理解：

```text
Action
Config
State
Action Invoke
Run
Log
Schema
```

HTTP、Shell、Filesystem、第三方 SDK 直接使用 Bun / npm。

***

## 35.4 ActionDock 不定义新的编程语言

```text
Language = TypeScript
Module system = ESM
Package ecosystem = npm
Package manager = Bun
```

ActionDock 只定义：

```text
Action contract
Runtime context
Build/package convention
Agent CLI protocol
```

***

# 36. 最终推荐架构

```text
                         Author
                           │
                           ▼
                    ActionDock CLI
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
       Action           Playbook          Config
     TypeScript         Markdown            │
         │                 │                 │
         │                 │              SQLite
         │                 │                 │
         ├──────────┐      │                 │
         ▼          ▼      │                 ▼
       State    Action Invoke               Run
         │          │                        │
         └──── SQLite Runtime ───────────────┘
                     │
                     ▼
                   Build
                     │
                  Bun.build
                     │
               compile target
                     │
                     ▼
                Executable
                     │
                     ▼
                 Skill Export
                     │
         ┌───────────┴───────────┐
         │                       │
      SKILL.md             package binary
         │                       │
         └───────────┬───────────┘
                     ▼
                  AI Agent
                     │
             no ActionDock install
```

***

# 37. 最终技术决策

## Adopt

```text
Bun
TypeScript
ESM
JSON Schema
Markdown
SQLite
CLI-first
Filesystem project
Standalone artifact
```

## Explicitly Avoid in V1

```text
Java
Spring
Groovy
Python runtime
Node runtime dependency
Server architecture
Web UI
ORM
Plugin framework
Agent framework
MCP
Workflow DSL
DAG engine
Permission framework
Knotra dependency
```

## Keep Open for Future

```text
Registry
Webhook/Schedule Host
UI
Rust native modules
WASM Components
permission/sandbox model
multiple build profiles
```

***

# 38. 一句话定义 ActionDock 2.0

中文：

> **ActionDock 是一个面向 AI Agent 的 Action 开发与分发工具链：用 TypeScript 编写和调试 Action，通过 Config、Shared State 和 Action Composition 完成工程化，最后构建成无需安装 ActionDock 或 Bun 即可直接使用的 standalone Skill。**

英文可以进一步收敛为：

> **Build and ship standalone actions for AI agents.**

或者强调零运行时依赖：

> **Build once. Ship actions that agents can run anywhere.**

***

# 39. 最重要的工程纪律

整个重写过程中始终用以下五个问题审查设计：

1. **这个概念是 Action 本身需要，还是作者管理工具需要？**
2. **Standalone artifact 是否真的需要知道它？**
3. **Bun / TypeScript / npm 已经解决了吗？**
4. **能否直接使用普通文件，而不是再创建数据库模型？**
5. **这个抽象带来的代码删除量是否大于它新增的复杂度？**

如果答案不够明确，就暂时不要加。

ActionDock 2.0 的目标不是把旧系统换一种语言完整重写，而是利用重写机会彻底改变复杂度分布：

```text
作者侧：能力完整
消费者侧：极简
Runtime：极小
Build：强
Artifact：一等公民
```

这才是这次重写最值得追求的结果。
