# CLI 参考

## 一句话理解

ActionDock CLI 是基于 oclif 的 TypeScript 命令行工具。它连接到 ActionDock 服务端，让你在终端中执行脚本、管理服务、查看 Schema。CLI 自动将脚本的 `inputSchema` 展平为 `--param value` 形式的命令行 flag。

## 安装

```bash
npm install -g actiondock
```

验证安装：

```bash
actiondock --version
# 输出: actiondock/<version>
```

检查本机服务是否可用：

```bash
actiondock health --json
```

## 连接目标

默认情况下，CLI 会连接本机服务：`http://127.0.0.1:5177`。本地开发或本机运行 `actiondock server` 时不需要先配置连接。

只有需要连接其他服务器、保存认证 Token，或频繁切换多个服务器时，才需要配置 profile。

```bash
# 创建带访问令牌的 profile（如果 API 启用了认证）
actiondock config add prod --server https://actiondock.example.com --token your-token-here

# 切换默认 profile
actiondock config use prod

# 查看当前 profile 配置
actiondock config show

# 临时使用其他 profile
actiondock script list --profile prod
```

### 环境变量方式

也可以通过环境变量临时指定连接目标：

```bash
export ACTIONDOCK_BASE_URL=http://localhost:5177
export ACTIONDOCK_TOKEN=your-token-here
export ACTIONDOCK_PROFILE=local
```

连接解析优先级：`--server` / `--token` > `--profile` > `ACTIONDOCK_BASE_URL` / `ACTIONDOCK_TOKEN` > `ACTIONDOCK_PROFILE` > 当前 profile > 默认 `http://127.0.0.1:5177`。

## 通用 list 意图搜索

业务资产类 `list` 命令支持 `--intent <regex>`。`intent` 是服务端执行的正则表达式，会在资产 ID、名称、描述、标签、来源仓库等摘要字段中匹配；如果正则没有命中，CLI 会自动退回同一查询条件下的全量列表，输出结构不变。

适用命令：

- `script list`
- `script repository-list`
- `plugin list`
- `repository list`
- `repository:knowledge-list`
- `playbook list`
- `webhook list`
- `webhook repository-list`
- `schedule list`
- `script preset list`
- `config-value list`

```bash
actiondock script list --intent "refund|payment" --json
actiondock playbook list --repository-id billing-service --enabled --intent "退款|支付超时" --json
actiondock repository:knowledge-list --intent "api|database" --json
```

`--intent` 用来先收窄候选，不改变详情命令和执行命令。需要完整定义时，继续使用对应的 `get` / `schema` / `action` 命令。

## 长 JSON 输出写文件

所有支持 `--json` 的命令都可以加 `--output-file <path>` 将完整 JSON 写入文件，避免长执行结果占满终端；文件已存在时需要加 `--overwrite-output` 覆盖。

```bash
actiondock execution get <execution-id> --json --output-file /tmp/actiondock-execution.json --overwrite-output
actiondock script run <script-id> --response-view debug --json --output-file /tmp/actiondock-run.json --overwrite-output
actiondock plugin invoke <plugin-id> <action> --json --output-file /tmp/actiondock-plugin.json --overwrite-output
```

## 脚本命令

脚本是 ActionDock 的主要资产对象。本节覆盖本地脚本的完整生命周期，以及来自仓库的脚本安装与管理。

命令归属原则：

- `repository` 命令管理仓库本身：连接、同步、删除、项目知识入口解析。
- `script repository-*` 命令管理“仓库里的脚本”：查看、安装、更新、卸载和创建工作副本。
- 仓库脚本 ID 在 CLI 参数里仍表现为第二个位置参数，例如 `team-tools hello-groovy`。旧文档或旧响应里出现的 `repositoryScriptId` 与这里的仓库脚本 ID 等价。

### 查看脚本列表

```bash
# 列出所有可用的脚本
actiondock script list

# 按意图正则先收窄候选，未命中时自动退回全量列表
actiondock script list --intent "refund|payment" --json

# 显示所有状态（含草稿等）
actiondock script list --all
```

### 查看 Schema

```bash
# 查看脚本的 inputSchema 和 outputSchema
actiondock script schema <script-id>
```

这个命令不只是展示结构，也是在告诉你 CLI 应该怎么传参：顶层简单字段可以直接展平为 flag，对象和数组字段继续使用 JSON 或文件方式。

输出示例：

```json
{
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "default": "world" }
    }
  }
}
```

### 执行脚本

```bash
# 基本执行
actiondock script run <script-id> --name alice --json

# 执行草稿版本
actiondock script run <script-id> --draft --name alice --json

# 以 debug 视图查看执行（含输入、日志、错误详情）
actiondock script run <script-id> --response-view debug --name alice

# debug 或输出很长时写入文件
actiondock script run <script-id> --response-view debug --name alice --json --output-file /tmp/actiondock-run.json --overwrite-output

# 复杂参数使用 --input-json 传入
actiondock script run <script-id> --input-json '{"name": "alice", "tags": ["a", "b"]}'
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| `--json` | 输出格式化为 JSON |
| `--output-file` | 将 JSON 输出写入文件 |
| `--overwrite-output` | 覆盖已有输出文件 |
| `--draft` | 执行草稿版本而非已发布版本 |
| `--response-view debug` | 显示调试视图（含日志、输入、错误详情） |
| `--input-json` | 以 JSON 字符串传入复杂参数 |
| `--<field-name>` | Schema 中展平的字段直接作为 flag |

### Schema 驱动的 CLI 参数

推荐顺序是：先看 schema，再判断字段是否能扁平，最后写执行命令。

对于简单类型字段（string、integer、number、boolean），CLI 自动展平：

```bash
# 如果 Schema 定义了:
# - name (string, required)
# - age (integer)
# - enabled (boolean)

actiondock script run my-script --name alice --age 30 --enabled --json
```

如果 schema 主要是简单字段，默认就按上面的扁平 flag 方式调用。

对象和数组类型不能展平，需要使用 `--input-json` 或 `--input-file`：

```bash
actiondock script run my-script --input-json '{"name": "alice", "metadata": {"source": "web"}}'
```

如果 schema 包含复杂字段，默认主路径就是 JSON 或文件传参，而不是把复杂字段拆成多级 flag。

`--server`、`--token`、`--profile` 是 CLI 连接参数保留字，不会作为 Schema 动态字段传入；如果脚本输入字段同名，请使用 `--input-json` 或 `--input-file`。

### 创建脚本

```bash
actiondock script create \
  --script-id my-new-script \
  --name "My Script" \
  --type groovy \
  --source-file ./script.groovy
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--script-id` | 是 | 脚本唯一标识 |
| `--name` | 是 | 人类可读名称 |
| `--type` | 是 | `groovy` 或 `python` |
| `--source-file` | 是 | 脚本源码文件路径 |

### 更新脚本

```bash
# 更新源码
actiondock script patch <id> --source-file ./new-source.groovy

# 更新名称和描述
actiondock script patch <id> --name "New Name"

actiondock script patch <id> --description "New description"

# 更新 inputSchema。对象字段会递归合并，数组会整体替换。
actiondock script patch <id> \
  --input-schema-json '{"properties":{"enabled":{"type":"boolean"}},"required":["enabled"]}'

# 删除 schema 内字段用 null
actiondock script patch <id> \
  --input-schema-json '{"properties":{"oldField":null}}'
```

`patch` 命令支持 JSON Merge Patch (RFC 7396) 部分更新。允许更新的顶层字段是 `name`、`description`、`source`、`pythonRequirements`、`inputSchema`、`outputSchema`；`--desc` 是 `--description` 的别名。`--patch-json` / `--patch-file` 也兼容 AI Schema Patch 提案里的 `inputSchemaPatch`、`outputSchemaPatch`，CLI 会分别转换为后端字段 `inputSchema`、`outputSchema`。

### 校验和发布

```bash
# 校验脚本语法
actiondock script validate <id>

# 发布脚本（产生不可变快照）
actiondock script publish <id>
```

### 来自仓库的脚本

命令前缀：`actiondock script repository-*`

脚本是主对象，仓库只是来源；因此仓库脚本操作放在脚本章节里。`actiondock repository ...` 只负责仓库连接与同步，不负责安装某个脚本资产。

#### 列出仓库脚本

```bash
actiondock script repository-list
actiondock script repository-list --repository team-tools
actiondock script repository-list --repository team-tools --intent "log|refund" --json
```

#### 查看仓库脚本详情

```bash
actiondock script repository-get team-tools hello-groovy
actiondock script repository-get team-tools hello-groovy --json
```

#### 安装仓库脚本

```bash
actiondock script repository-install team-tools hello-groovy
actiondock script repository-install team-tools hello-groovy \
  --install-script-dependencies \
  --install-plugin-dependencies \
  --install-schedules
```

#### 更新已安装的仓库脚本

```bash
actiondock script repository-update team-tools hello-groovy
actiondock script repository-update team-tools hello-groovy \
  --install-script-dependencies \
  --install-plugin-dependencies \
  --install-schedules
```

#### 卸载仓库脚本

```bash
actiondock script repository-uninstall hello-groovy
actiondock script repository-uninstall hello-groovy --json
```

这里传的是本地脚本 ID，不是仓库里的 `scriptId`。

#### 创建脚本工作副本

```bash
actiondock script repository-working-copy team-tools hello-groovy
actiondock script repository-working-copy team-tools hello-groovy --script-id hello-groovy-copy
```

### 上游同步

查看或拉取脚本工作副本的上游更新：

```bash
actiondock script upstream-status hello-groovy
actiondock script upstream-pull hello-groovy
actiondock script upstream-pull hello-groovy --force
```

## Webhook 命令

### 本地 Webhook

#### 列出 Webhook

```bash
actiondock webhook list --json
actiondock webhook list --intent "github|order" --json
```

#### 查看 Webhook 详情

```bash
actiondock webhook get <webhook-id>
actiondock webhook get <webhook-id> --json
```

#### 创建 Webhook

```bash
actiondock webhook create --definition-json '{"key": "order-created", "transportType": "HTTP"}'

actiondock webhook create \
  --definition-file ./webhook.json \
  --webhook-id my-webhook \
  --name "Order Created"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--definition-json` | 是 | Webhook 定义的 JSON 字符串 |
| `--definition-file` | 否 | Webhook 定义文件路径（替代 `--definition-json`） |
| `--webhook-id` | 否 | Webhook ID 覆盖 |
| `--name` | 否 | Webhook 名称 |
| `--key` | 否 | Webhook key |
| `--transport-type` | 否 | 传输类型 |

#### 更新 Webhook

```bash
actiondock webhook update <webhook-id> --name "New Name" --enabled
actiondock webhook update <webhook-id> --definition-json '{"key": "updated-key"}'
```

#### 删除 Webhook

```bash
actiondock webhook delete <webhook-id>
actiondock webhook delete <webhook-id> --json
```

#### 启用 / 禁用 Webhook

```bash
actiondock webhook enable <webhook-id>
actiondock webhook disable <webhook-id>
```

#### 触发 Webhook

```bash
actiondock webhook invoke <webhook-id>
actiondock webhook invoke <webhook-id> --payload-json '{"event": "test"}'
actiondock webhook invoke <webhook-id> --payload-file ./payload.json
```

#### 发布 Webhook 到仓库

```bash
actiondock webhook publish order-created \
  --repository team-tools \
  --repository-webhook-id order-created \
  --display-name "Order Created" \
  --version 1.0.0
```

带依赖脚本映射与配置模板的例子：

```bash
actiondock webhook publish order-created \
  --repository team-tools \
  --repository-webhook-id order-created \
  --display-name "Order Created" \
  --version 1.0.0 \
  --owner team4u \
  --release-notes "首次发布" \
  --tag webhook \
  --tag order \
  --script-dependencies-file ./script-dependencies.json \
  --config-items-file ./config-items.json \
  --publish-script-dependencies
```

参数说明：

| 参数 | 必填 | 说明 |
|------|------|------|
| `--repository` | 是 | 目标仓库 ID |
| `--repository-webhook-id` | 是 | 仓库中的 Webhook ID |
| `--display-name` | 是 | 发布显示名 |
| `--version` | 是 | 发布版本 |
| `--owner` | 否 | 发布所有者 |
| `--release-notes` | 否 | 发布说明 |
| `--tag` | 否 | 标签，可重复传入 |
| `--script-dependencies-json` / `--script-dependencies-file` | 否 | 依赖脚本映射数组 |
| `--config-items-json` / `--config-items-file` | 否 | 配置模板数组 |
| `--publish-script-dependencies` | 否 | 连同 `scripts.invoke(...)` 依赖脚本一起发布，默认开启 |
| `--force` | 否 | 忽略可强制覆盖的发布冲突 |

`--script-dependencies-*` 传的是 JSON 数组，每一项形如：

```json
[
  {
    "scriptId": "shared-helper",
    "repositoryId": "team-tools",
    "repositoryScriptId": "shared-helper",
    "versionRange": "^1.0.0"
  }
]
```

当 Webhook 绑定脚本依赖其他本地脚本时，CLI 会把映射提交给后端；如果启用 `--publish-script-dependencies`，这些依赖脚本会参考现有脚本发布流程递归一起发布。

### 来自仓库的 Webhook

命令前缀：`actiondock webhook repository-*`

虽然命令名挂在 `webhook repository-*`，但语义上仍属于 Webhook 生命周期。

#### 列出仓库 Webhook

```bash
actiondock webhook repository-list
actiondock webhook repository-list --repository team-tools
actiondock webhook repository-list --repository team-tools --intent "order|crm" --json
```

#### 查看仓库 Webhook 详情

```bash
actiondock webhook repository-get team-tools order-created
actiondock webhook repository-get team-tools order-created --json
```

#### 安装仓库 Webhook

```bash
actiondock webhook repository-install team-tools order-created
actiondock webhook repository-install team-tools order-created --install-script-dependencies
```

#### 更新已安装的仓库 Webhook

```bash
actiondock webhook repository-update team-tools order-created
actiondock webhook repository-update team-tools order-created --install-script-dependencies
```

#### 创建 Webhook 工作副本

```bash
actiondock webhook repository-working-copy team-tools order-created
actiondock webhook repository-working-copy team-tools order-created --webhook-id order-created-copy
```

### 上游同步

查看或拉取 Webhook 工作副本的上游更新：

```bash
actiondock webhook upstream-status order-created
actiondock webhook upstream-pull order-created
actiondock webhook upstream-pull order-created --force
```

## 仓库定义与项目知识

本节只覆盖仓库定义的管理操作和项目知识入口。仓库中的脚本和 Webhook 安装操作，分别在各自的章节中说明。

| 你要做的事 | 去哪里看 |
|---|---|
| 从仓库查找/安装脚本 | 脚本 → 来自仓库的脚本 |
| 从仓库查找/安装 Webhook | Webhook → 来自仓库的 Webhook |
| 管理仓库定义 / 同步仓库 / 解析项目知识 | 本节 |

### 仓库定义管理

#### 列出仓库

```bash
actiondock repository list
actiondock repository list --purpose capability
actiondock repository list --purpose project --intent "billing|order"
```

`purpose` 用来区分仓库用途：

- `CAPABILITY`：分发脚本、插件、Skills、能力包
- `PROJECT`：指向业务项目代码库，并暴露项目知识入口

#### 创建仓库

```bash
actiondock repository create \
  --repository-id team-tools \
  --name "Team Tools" \
  --type git \
  --purpose capability \
  --url https://github.com/example/team-tools.git \
  --branch main

actiondock repository create \
  --repository-id billing-service \
  --name "Billing Service" \
  --type local-dir \
  --purpose project \
  --url /Users/code/projects/billing-service
```

项目仓库支持：

- `--type git`
- `--type local-dir`

项目知识入口固定为仓库根目录 `ACTIONDOCK.md`。

#### 更新仓库

```bash
actiondock repository update billing-service \
  --name "Billing Service" \
  --type local-dir \
  --purpose project \
  --url /Users/code/projects/billing-service \
  --enabled
```

#### 删除仓库

```bash
actiondock repository delete billing-service
actiondock repository delete billing-service --json
```

#### 同步仓库

```bash
actiondock repository sync billing-service
actiondock repository sync billing-service --json
```

这个命令用于手工同步仓库内容。

- `GIT` 仓库会拉取最新内容到本地副本
- `LOCAL_DIR` 仓库会做本地目录检查
- 项目仓库如果是 `GIT` 类型，通常先执行这个命令，再执行 `repository resolve`

### 项目仓库解析

```bash
actiondock repository resolve --repository-id billing-service
actiondock repository resolve --repository-id billing-service --json
```

这个命令会：

1. 按仓库 ID 定位 `purpose=PROJECT` 的仓库
2. 读取项目根目录下的 `ACTIONDOCK.md`
3. 返回项目根路径、入口路径和原始 Markdown 内容

说明：

- `repository resolve` 不会触发仓库同步
- `GIT` 类型项目仓库需要先通过定时任务或手工同步准备好本地副本

### 知识源管理

知识源是 CAPABILITY 仓库中的指针，安装后自动注册为 PROJECT 仓库。

```bash
# 列出所有知识源
actiondock repository:knowledge-list --json

# 列出指定仓库的知识源
actiondock repository:knowledge-list --repository-id team-repo --intent "api|database" --json

# 查看知识源详情
actiondock repository:knowledge-get --repository-id team-repo --knowledge-id product-api --json

# 安装知识源（自动注册为 PROJECT 仓库）
actiondock repository:knowledge-install --repository-id team-repo --knowledge-id product-api

# 卸载知识源
actiondock repository:knowledge-uninstall --repository-id team-repo --knowledge-id product-api
```

### 返回结果示例

```json
{
  "repositoryId": "billing-service",
  "type": "LOCAL_DIR",
  "purpose": "PROJECT",
  "root": "/Users/code/projects/billing-service",
  "entryPath": "ACTIONDOCK.md",
  "enabled": true,
  "exists": true,
  "content": "# Billing Service\n\n## 优先阅读\n\n1. `overview.md`\n..."
}
```

推荐用法：

1. 先读 `content`
2. 再按正文中描述的入口文件、目录和关键词去 `read` / `grep`
3. 只有在 Markdown 不足时再读源码

## 插件命令

## 任务手册命令

### 查看任务手册

```bash
actiondock playbook list --json
actiondock playbook list --repository-id <repositoryId> --tag <tag> --enabled --intent "refund|timeout" --json
actiondock playbook get <playbook-id> --json
```

- `playbook list --json` 返回任务手册摘要列表，适合筛选候选；默认包含 `id`、`name`、`description`、`riskLevel`、`tags`、`repositoryIds`、启用状态和托管状态。
- `playbook list --json` 不返回 `guideMarkdown`、`knowledgeRefs`、`scriptRefs`、`stopConditions` 等大字段。
- `--intent` 先按任务意图正则搜索摘要字段；未命中时 CLI 自动退回原过滤条件下的全量摘要列表，便于 Agent 继续做兜底判断。
- 需要单个任务手册的完整定义、导览文本、知识引用、脚本引用和停止条件时，使用 `playbook get <playbook-id> --json`。

### 查看插件

```bash
actiondock plugin list --json
actiondock plugin list --intent "workspace|ai" --json
actiondock plugin get <plugin-id> --json
actiondock plugin action <plugin-id> <action> --json
actiondock plugin references --json
actiondock plugin config get <plugin-id> --json
actiondock plugin config list <plugin-id> --json
actiondock plugin config get <plugin-id> --config-name prod --json
```

- `plugin list` 只返回已安装插件的摘要（状态、版本、动作数量）。
- `plugin get <plugin-id>` 返回该插件的元信息及所包含的所有动作（仅包含动作名、标题和描述，不含详细参数 Schema）。
- `plugin action <plugin-id> <action>` 返回具体某个动作的完整 Schema（包括 `inputSchema`、`outputSchema` 及传参示例）。


### 调用插件动作

```bash
actiondock plugin invoke <plugin-id> <action> --json
```

插件调用有三类输入：

| 输入 | 用法 |
|------|------|
| action args 简单字段 | `--name value`、`--count 3`、`--enabled` |
| action args 复杂字段 | `--args-json` / `--args-file` |
| 脚本上下文 | `--script-input-json` / `--script-input-file` |
| 命名插件配置 | `--config-name <name>` |

顶层 string、number、integer、boolean、enum 字段可直接展开：

```bash
actiondock plugin invoke my-plugin summarize --topic ops --priority 3 --json
```

对象和数组类型不能展开，使用 `--args-json` 或 `--args-file`：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-json '{"topic":"ops","filters":{"env":"prod"}}' \
  --json
```

`--args-file` 提供基础 action args 对象，动态 flag 会合并进去并覆盖同名字段：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --topic override \
  --json
```

如果插件动作需要脚本侧上下文，额外传 `scriptInput`：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-json '{"topic":"ops"}' \
  --script-input-json '{"locale":"zh-CN"}' \
  --json
```

如果插件保存了多份配置，调用时可选择其中一份；未指定时使用默认配置：

```bash
actiondock plugin invoke my-plugin summarize \
  --config-name prod \
  --args-json '{"topic":"ops"}' \
  --json
```

`--input-json` / `--input-file` 只用于 `script run`，不要用于 `plugin invoke`。

## 配置命令参考

```bash
actiondock config add <name> --server <url> [--token <token>]  # 创建或更新 profile
actiondock config use <name>                                   # 设置当前 profile
actiondock config list                                         # 列出 profiles
actiondock config show [--profile <name>]                      # 查看 profile 配置
actiondock config set server <url> [--profile <name>]          # 更新服务器地址
actiondock config set token <token> [--profile <name>]         # 更新访问令牌
actiondock config clear token [--profile <name>]               # 清除访问令牌
actiondock config remove <name>                                # 删除 profile
```

## 服务管理

```bash
actiondock server        # 前台启动服务
actiondock server -p 8080  # 指定端口启动
actiondock health --json # 检查服务健康状态
```

## 完整示例流程

```bash
# 1. 安装 CLI
npm install -g actiondock

# 2. 检查服务并查看可用脚本（默认连接 http://127.0.0.1:5177）
actiondock health --json
actiondock script list --intent "hello" --json

# 3. 查看脚本 Schema
actiondock script schema hello-groovy

# 4. 执行脚本
actiondock script run hello-groovy --name alice --json

# 5. 创建新脚本
cat > my-script.groovy << 'EOF'
return [greeting: "Hello, ${input.name}!", timestamp: System.currentTimeMillis()]
EOF

actiondock script create \
  --script-id my-script \
  --name "My Script" \
  --type groovy \
  --source-file my-script.groovy

# 6. 发布
actiondock script publish my-script

# 7. 执行验证
actiondock script run my-script --name alice --json

# 8. 解析项目仓库知识入口
actiondock repository resolve --repository-id my-project --json
```

## 常见问题

### Q: actiondock: command not found

CLI 没有安装或不在 PATH 中。检查：
```bash
npm list -g actiondock
```

如果未安装：`npm install -g actiondock`

### Q: 连接失败

1. 检查 ActionDock 服务是否在运行：`actiondock health --json`
2. 检查服务器地址配置：`actiondock config show`
3. 多 server 场景确认当前 profile：`actiondock config list`
4. 检查是否有网络防火墙拦截

### Q: Token 认证失败

1. 确认 Token 是否有效（在管理台检查令牌状态）
2. 确认当前 profile 的 Token 设置正确：`actiondock config set token <正确的 Token>`
3. 临时连接其他服务端时确认是否传了正确的 `--profile <name>`

---

> [返回目录](user-manual.md) | 下一步：查看 [API 参考与常见问题](api-reference.md)
