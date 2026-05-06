# ActionDock 用户操作手册

> ActionDock 是一套把脚本、插件、仓库分发、AI 调用和运行治理放进同一运行体系的工具平台。同一份脚本定义，可以同时被人、REST API、CLI 和 Agent 使用。

---

## 目录

- [简介与快速开始](#简介与快速开始)
- [脚本管理](#脚本管理)
- [插件管理](#插件管理)
- [Skills 管理](#skills-管理)
- [AI 能力](#ai-能力)
- [仓库与分发](#仓库与分发)
- [触发中心](#触发中心)
- [系统设置](#系统设置)
- [脚本编写指南](#脚本编写指南)
- [CLI 速查](#cli-速查)
- [API 概览与常见问题](#api-概览与常见问题)

---

## 简介与快速开始

### ActionDock 是什么

ActionDock 解决的核心问题是：把零散脚本升级成团队可复用、可分发、可审计、可被 AI 稳定调用的脚本资产。

它和普通脚本平台的区别：

| 维度 | 脚本目录 + cron | 只暴露 API 的脚本服务 | ActionDock |
|------|------------------|------------------------|------------|
| 工具输入输出契约 | 通常没有 | 需要手写 DTO / 文档 | 内建 `inputSchema` / `outputSchema` |
| 草稿与发布 | 通常没有 | 依赖额外发布流程 | 内建草稿、发布快照、丢弃草稿 |
| 团队分发 | 拷文件 / Git 约定 | 重新部署服务 | 仓库发现、安装、更新、开发同步 |
| 插件扩展 | 零散 SDK | 常需改主服务 | PF4J 插件机制，脚本侧统一调用 |
| AI 接入 | prompt 拼接 | 需额外接工具层 | AI Toolset、Agent、脚本桥接 |
| 共享状态治理 | 落文件 / Redis 自管 | 另接状态服务 | 内建共享状态 `namespace + key + JSON + version + CAS` |
| 多入口调用 | 各写各的 | API 为主 | UI、REST、CLI、Agent 共用同一脚本 |

### 核心能力

- 统一脚本抽象：脚本不是一段源码，而是带 Schema、发布快照、依赖、日志和执行入口的脚本资产
- 多入口复用：管理台、REST API、CLI、Agent 共用同一脚本
- 仓库化协作：脚本、插件、AI 能力包可从仓库发现、安装、更新
- AI 原生集成：脚本可暴露给 Agent，AI 辅助生成、诊断、Review
- 治理能力完整：内置配置值、共享状态、访问令牌、执行记录、定时任务、备份恢复

### 系统要求

- JDK 21+
- Maven 3.9+（本地构建时）
- Node.js 18+（前端开发或 CLI 时）
- Python 3.x（执行 PYTHON 类型脚本时，默认命令为 `python3`）
- Docker（可选，容器化部署时）

### 安装与启动

本地启动：


```bash
npm install -g actiondock
actiondock server     # 前台启动服务
```

启动后访问：
- 管理台：`http://localhost:5177/admin/app/scripts`
- REST API：`http://localhost:5177/api`
- Swagger UI：`http://localhost:5177/swagger-ui.html`

### 第一个脚本：Hello World

服务默认会初始化示例脚本 `hello-groovy`。

在管理台运行：

- 打开管理台，进入「脚本库」页面
- 找到 `hello-groovy` 脚本
- 点击「运行」按钮
- 在输入表单中填入 `name: alice`
- 点击执行，查看结果

通过 REST API 运行：

```bash
curl -X POST http://localhost:5177/api/scripts/hello-groovy/published/execute \
  -H 'Content-Type: application/json' \
  -d '{"input": {"name": "alice"}, "mode": "SYNC"}'
```

通过 CLI 运行：

```bash
actiondock script run hello-groovy --name alice --json
```

### UI 导览

管理台左侧导航分为四个区域：

| 区域 | 包含功能 |
|------|----------|
| 能力 | 脚本库、插件管理、Skills 管理、AI（模型、Agent、Toolset、运行记录） |
| 资源 | 仓库发现、仓库管理 |
| 触发 | 触发中心（定时任务、事件源、事件触发、事件记录） |
| 设置 | 配置值、共享状态、访问令牌、控制台凭证、数据备份 |

---

## 脚本管理

脚本管理是 ActionDock 的核心功能。脚本不是普通的源码文件，而是带有输入/输出 Schema、发布快照、依赖声明的脚本资产。

### 脚本库

路径：管理台 → 能力 → 脚本库

脚本库页面展示所有已创建和已安装的脚本，支持搜索和筛选。

筛选条件：

- 来源：全部 / 个人 (PERSONAL) / 仓库 (REPOSITORY) / Fork / 开发 (DEVELOPMENT) / 示例 (SAMPLE)
- 状态：全部 / 已发布 (PUBLISHED) / 草稿 (DRAFT) / 可更新 (UPDATE_AVAILABLE) / 远程有变更 (REMOTE_CHANGES) / 已分叉 (DIVERGED) / 只读 (READ_ONLY)
- 类型：全部 / Python / Groovy

表格列：

| 列 | 说明 |
|----|------|
| 脚本名称/ID | 脚本标识，点击进入编辑器 |
| 来源/状态标签 | 显示脚本作用域和发布状态 |
| 操作 | 运行、复制、导出、更新、卸载 |

工具栏操作：

- 刷新：重新加载脚本列表
- 一键更新：同步所有仓库并更新所有可更新的脚本
- 导出可编辑：批量导出个人脚本为 JSON 文件
- 导入脚本：从 JSON 文件导入脚本
- 新建脚本：创建新的个人脚本

### 创建脚本

点击「新建脚本」进入脚本编辑器。编辑器包含以下部分：

基本信息：

| 字段 | 说明 |
|------|------|
| Script ID | 脚本唯一标识符（创建后不可修改） |
| 脚本名称 | 人类可读名称 |
| 脚本类型 | `GROOVY` 或 `PYTHON` |
| 打包类型 | `TOOL`（工具型）或 `FLOW`（流程型） |
| 描述 | 脚本用途说明 |

源码编辑：

使用 Monaco Editor 编辑脚本源码，支持语法高亮和自动补全。

Schema 定义：

- inputSchema：定义脚本的输入参数结构（JSON Schema 格式），驱动 CLI flag 生成、UI 表单生成、AI 工具描述
- outputSchema：定义脚本的输出结构

依赖声明：

- 脚本依赖：引用其他已发布脚本，通过 `scripts.invoke()` 调用
- 插件依赖：声明所需插件及其 Action
- AI 依赖：声明所需 AI 能力（如 CHAT、STRUCTURED_OUTPUT）

Python 专属：

- `pythonRequirements`：等同于 requirements.txt，声明第三方依赖

### 编辑脚本

点击脚本列表中的脚本名称进入编辑器。编辑器与创建页面相同，额外提供：

- 只读标识：REPOSITORY 作用域的脚本为只读，需要 Fork 后才能编辑
- 开发同步状态：DEVELOPMENT 作用域的脚本会显示同步状态标签：
  - `SYNCED`：本地与远程一致
  - `LOCAL_CHANGES`：有本地未同步修改
  - `REMOTE_CHANGES`：远程有新版本
  - `DIVERGED`：本地和远程都有修改，需要手动处理

### 脚本生命周期

```
草稿 (DRAFT) → 发布 (PUBLISHED) → 归档 (ARCHIVED)
     ↑              ↓
     └── 丢弃草稿 ──┘
```

- 草稿：可以自由编辑和调试，通过 `--draft` 参数执行草稿版本，不影响线上版本
- 发布：产生不可变快照，被调脚本和定时任务始终走 published 版本
- 丢弃草稿：一键回到上次发布版本

### 执行脚本

在脚本编辑器的「执行」标签页中：

- 输入表单根据 `inputSchema` 自动生成
- 可切换「表单模式」和「JSON 模式」手动编辑输入
- 选择执行模式：
  - SYNC：同步等待结果返回
  - ASYNC：异步提交，不等待结果
- 查看执行结果（格式化输出）和调试视图（完整上下文、日志、错误详情）

执行历史：

执行历史表格显示每次执行的记录，包括：
- 执行状态（PENDING / RUNNING / SUCCESS / FAILED）
- 触发来源（MANUAL / SCHEDULED / AI_TOOL / EVENT）
- 执行时间
- 点击行可查看执行详情

执行预设：

保存常用的输入参数组合，方便重复执行。

### 导入与导出

- 导出：支持单个或批量导出个人脚本为 JSON 文件
- 导入：上传 JSON 文件，对已有脚本会显示差异预览，确认后导入

### Fork 仓库脚本

对 REPOSITORY 作用域的脚本点击「Fork」：

- 创建一个 FORK 作用域的可编辑副本
- 可以独立修改、发布、管理
- 与原始仓库脚本不再关联

---

## 插件管理

插件机制让平台能力可以扩展，而不需要把所有功能写死在脚本里。

### 插件列表

路径：管理台 → 能力 → 插件管理

表格列：

| 列 | 说明 |
|----|------|
| Plugin ID | 插件标识（点击进入详情） |
| 名称 | 人类可读名称 |
| 状态 | `STARTED`（绿色）/ `STOPPED`（金色）/ `FAILED`（红色） |
| 版本 | 插件版本号 |
| 来源 | 仓库安装或手动上传 |
| Actions 数 | 插件提供的动作数量 |

工具栏：

- 刷新：重新加载插件列表
- 一键更新：同步所有仓库并更新所有仓库来源的插件
- 上传安装：上传 `.jar` 文件安装插件

### 安装插件

- 点击「上传安装」按钮
- 选择符合 PF4J 规范的 `.jar` 文件
- 上传后插件出现在列表中（可能需要手动启动）

### 插件生命周期管理

对每个插件可执行以下操作：

| 操作 | 说明 |
|------|------|
| 启动 | 激活插件 |
| 停止 | 停用插件 |
| 升级 | 上传新版本 `.jar` 文件（支持回滚） |
| 卸载 | 移除插件（可勾选强制卸载） |

### 插件详情

点击插件 ID 进入详情页，可查看：

- 插件 Manifest 信息（名称、描述、版本）
- 可用 Actions 及其 Schema
- 配置 Schema（如果插件可配置）
- 插件依赖和版本要求
- 配置编辑和保存
- 调用 Action 进行调试

### 在脚本中调用插件

在 Groovy 脚本中：

```groovy
def result = plugins.invoke("my-plugin", "hello", [name: "world"])
```

在 Python 脚本中：

```python
result = plugins.invoke("my-plugin", "hello", {"name": "world"})
```

调用插件和调用另一个脚本的体验完全一致，调用方不关心底层是编译型插件还是解释型脚本。

---

## Skills 管理

Skills 是可安装的技能包（例如 Claude Skills），可以安装到指定的目标目录中。

### Skills 列表

路径：管理台 → 能力 → Skills 管理

Skills 管理页面包含两个标签页：

- Skills 列表：已安装的技能包
- 目标管理：技能安装的目标目录

### 目标管理

技能目标 (Skill Target) 是技能安装的目录。

添加目标：

| 字段 | 说明 |
|------|------|
| ID | 目标唯一标识 |
| 名称 | 人类可读名称 |
| 类型 | `CLAUDE` 或 `CUSTOM`（选择类型后自动建议路径，如 `~/.claude/skills`） |
| 根路径 | 技能安装的目录 |
| 启用 | 是否启用 |

操作：添加、编辑、删除目标；扫描目标目录；同步安装到目标。

### 安装 Skills

路径：管理台 → 能力 → Skills 安装

支持三种安装方式：

- GitHub 集合：输入 GitHub 集合 URL，扫描并选择安装
- 本地目录：选择本地目录进行安装
- 归档文件：上传 `.zip` 归档文件

安装时需要选择目标（可多选）。

### 发布 Skills

路径：管理台 → 能力 → Skills 发布

将本地技能打包并发布到仓库进行分发。

### Skill 详情

点击 Skill 名称进入详情页，可查看：

- Skill 元数据（ID、名称、描述、版本）
- 文件浏览
- 各目标的安装状态
- 启用/禁用、删除操作

---

## AI 能力

ActionDock 内建 AI 能力，不是外挂，而是平台原生功能。支持管理模型配置、Agent 配置、Toolset 和运行记录。

### AI 概览

路径：管理台 → 能力 → AI

AI 概览页面展示：

- 模型管理卡片：显示已启用的模型数量和警告（如缺少 API Key 配置）
- Agent 管理卡片：显示已启用的 Agent 数量
- Toolset 管理卡片：显示已启用的 Toolset 数量
- 最近运行表格：最近 8 条 Agent 运行记录

### 模型配置

路径：管理台 → 能力 → AI → 模型管理

配置字段：

| 字段 | 说明 |
|------|------|
| ID | 模型配置唯一标识 |
| 名称 | 人类可读名称 |
| 模型供应商 | `DASHSCOPE` / `OPENAI` / `OPENAI_COMPATIBLE` / `ANTHROPIC` / `GEMINI` / `OLLAMA` |
| 模型名称 | 供应商模型标识，如 `gpt-4o`、`qwen-max` |
| Base URL | 自托管或兼容端点的地址（可选） |
| API Key 配置键 | 引用 Config Value 中存储 API Key 的键名 |
| 能力 | `CHAT` / `STRUCTURED_OUTPUT` / `EMBEDDING` |
| 默认选项 | JSON 格式，如 `temperature`、`max_tokens` 等 |
| 限制 | JSON 格式，如速率限制 |
| 启用 | 是否启用 |

提供「测试模型」按钮，发送测试 Prompt 验证连通性。

### Agent 配置

路径：管理台 → 能力 → AI → Agent 管理

配置字段：

| 字段 | 说明 |
|------|------|
| ID | Agent 唯一标识 |
| 名称 | 人类可读名称 |
| 描述 | Agent 用途说明 |
| 模型配置 | 关联的模型配置（下拉选择） |
| System Prompt | 系统提示词 |
| Toolset 引用 | 关联的 Toolset（可多选） |
| 直接工具 | 不在 Toolset 中的额外工具名称 |
| Skill IDs | 加载到 Agent 上下文的 Skill |
| 选项 | JSON 格式的 Agent 特定参数 |
| 启用 | 是否启用 |

提供「测试 Agent」按钮，直接启动一次测试运行。

### Toolset 管理

路径：管理台 → 能力 → AI → Toolset 管理

Toolset 是工具的集合，定义 Agent 可以使用哪些工具。

配置字段：

| 字段 | 说明 |
|------|------|
| ID | Toolset 唯一标识 |
| 名称 | 人类可读名称 |
| 描述 | Toolset 用途说明 |
| 工具列表 | 从已注册工具中搜索和选择 |
| 最大权限 | `READ_ONLY` / `PROPOSE_CHANGE` / `CONTROLLED_ACTION` / `DANGEROUS_ACTION` |
| 启用 | 是否启用 |

工具来源：
- SYSTEM：平台内置工具
- SCRIPT：脚本暴露的工具
- AGENT：Agent 级别工具

### AI 运行记录

路径：管理台 → 能力 → AI → 运行记录

列表信息：

| 列 | 说明 |
|----|------|
| Run ID | 运行标识 |
| Agent | 使用的 Agent 配置 |
| 状态 | `RUNNING` / `SUCCESS` / `FAILED` / `WAITING_APPROVAL` / `CANCELLED` / `INTERRUPTED` |
| 调用方类型 | `SCRIPT` / `PLUGIN` / `ADMIN_TEST` / `AGENT` |
| 开始时间 | 运行开始时间 |

运行详情：

点击 Run ID 进入详情页，可查看：

- 步骤追踪面板：每个步骤的类型（`MODEL_REASONING`、`TOOL_CALL`、`TOOL_RESULT`、`APPROVAL`、`INTERRUPT`）、延迟、输入输出、错误
- 用量统计：输入/输出/总 Token 数
- 完整对话消息

---

## 仓库与分发

仓库系统是 ActionDock 的包管理器，负责脚本、插件和 AI 能力包的发现、安装和分发。

### 仓库发现

路径：管理台 → 资源 → 仓库发现

仓库发现页面浏览所有已配置仓库中的可用资源，分为以下类别：

- 工具 (Tools)：可安装的脚本
- 插件 (Plugins)：可安装的插件
- AI 能力包：AI 相关的配置包
- Skills：可安装的技能包

每个资源项显示名称、描述、类型、版本、信任级别和依赖关系。支持一键安装和更新。

### 仓库管理

路径：管理台 → 资源 → 仓库管理

表格列：

| 列 | 说明 |
|----|------|
| ID | 仓库标识（点击进入详情） |
| 名称 | 人类可读名称 |
| 类型 | `GIT` / `HTTP` / `LOCAL_DIR` |
| 用途 | `DISTRIBUTION`（分发）/ `DEVELOPMENT`（开发） |
| 信任级别 | `TRUSTED`（受信）/ `UNTRUSTED`（非受信） |
| 状态 | 同步状态 |
| 操作 | 同步、编辑、删除 |

创建/编辑仓库：

| 字段 | 说明 |
|------|------|
| ID | 仓库唯一标识 |
| 名称 | 人类可读名称 |
| 类型 | `GIT` / `HTTP` / `LOCAL_DIR` |
| URL | Git URL、HTTP URL 或本地目录路径 |
| Branch | Git 类型时指定分支（可选） |
| 启用 | 是否启用 |
| 信任级别 | `TRUSTED` / `UNTRUSTED` |
| 用途 | `DISTRIBUTION`（只读分发）/ `DEVELOPMENT`（可编辑开发） |
| 描述 | 仓库用途说明 |

### 安装仓库工具

从仓库发现页面点击「安装」：

- 确认对话框显示脚本的依赖信息
- 可选择是否安装关联的依赖项
- 安装后脚本出现在脚本库中，作用域为 `REPOSITORY`

### 更新已安装工具

- 一键更新：同步所有仓库后更新所有可更新的脚本
- 单脚本更新：在脚本列表中对有 `UPDATE_AVAILABLE` 状态的脚本单独更新
- 开发脚本同步：DEVELOPMENT 作用域的脚本可从远程拉取更新

### 发布脚本到仓库

从脚本编辑器中选择「发布到仓库」：

- 选择目标仓库
- 系统将已发布的脚本快照打包发布到仓库
- 团队其他成员同步仓库后即可看到并安装

---

## 触发中心

触发中心管理所有自动化执行方式：定时任务和事件驱动。

### 概览

路径：管理台 → 触发 → 触发中心

触发中心包含四个标签页：

| 标签页 | 功能 |
|--------|------|
| 定时触发 | Cron 定时任务管理 |
| 事件源 | 外部事件接入口定义 |
| 事件触发 | 事件到脚本的路由规则 |
| 事件记录 | 事件接收和分发历史 |

> 事件框架的详细配置指南请参考 [事件框架配置指南](event-framework.md)。

### 定时任务

路径：管理台 → 触发 → 定时任务编辑器

列表信息：

| 列 | 说明 |
|----|------|
| Schedule ID | 调度标识 |
| 名称 | 人类可读名称 |
| 脚本 | 关联的已发布脚本 |
| Cron 表达式 | 标准 5 字段 Cron |
| 启用状态 | 是否启用 |
| 上次/下次执行 | 执行时间信息 |

创建/编辑：

| 字段 | 说明 |
|------|------|
| 脚本 ID | 选择已发布的脚本 |
| 调度名称 | 人类可读名称 |
| Cron 表达式 | 标准 5 字段格式（如 `0 */5 * * *` 表示每 5 分钟） |
| 输入参数 | JSON 格式，匹配脚本的 `inputSchema` |
| 启用 | 是否启用 |

操作：启用、禁用、编辑、删除、查看最近执行结果。

### 事件源

事件源定义外部系统的接入口。

创建字段：

| 字段 | 说明 |
|------|------|
| 名称 | 人类可读名称 |
| Key | 唯一业务键，如 `crm.customer.created` |
| 传输方式 | 当前支持 `HTTP_WEBHOOK` |
| Webhook 端点 | 系统自动生成，外部系统 POST 到此地址 |
| 鉴权模式 | `NONE` / `HEADER_TOKEN` / `QUERY_TOKEN` / `HMAC_SHA256` |
| 标准化处理器 | 将原始请求转为统一事件格式 |
| 样例上下文 | 测试用的 Headers、Query、Body 样例 |

鉴权模式建议：

- 内部系统：先用 `HEADER_TOKEN`
- 公开 Webhook：优先用 `HMAC_SHA256`

测试标准化：使用样例上下文测试处理器输出，确认标准化结果符合预期。

### 事件触发

事件触发定义事件到脚本的路由规则。

创建字段：

| 字段 | 说明 |
|------|------|
| 名称 | 人类可读名称 |
| 描述 | 触发器用途说明 |
| 事件源 | 选择已配置的事件源 |
| 目标脚本 | 必须是已发布 (PUBLISHED) 状态的脚本 |
| 过滤处理器 | 输出 `{"matched": true/false}`，决定是否触发 |
| 幂等处理器 | 输出 `{"key": "unique-id"}`，防止重复触发 |
| 输入处理器 | 输出匹配目标脚本 `inputSchema` 的对象 |
| 提交模式 | `SYNC`（同步）或 `ASYNC`（异步，推荐） |
| 启用 | 是否启用 |

调试流程：

- 先使用「测试」按钮验证处理器输出（不执行目标脚本）
- 再使用「试运行」创建一次真实的执行记录
- 最后在「事件记录」中查看完整的链路信息

### 事件记录

列表信息：

| 列 | 说明 |
|----|------|
| 记录 ID | 事件记录标识 |
| 事件源 | 来源事件源 |
| 标准事件 | 标准化后的事件摘要 |
| 状态 | 处理状态 |
| 时间戳 | 事件接收时间 |

记录详情：

点击记录可查看：

- 原始请求（Headers、Query、Body）
- 标准化事件
- 分发记录（哪些触发器命中、执行结果、错误信息）

### 处理器类型

事件框架中使用的处理器支持三种模式：

| 模式 | 适用场景 | 说明 |
|------|----------|------|
| `JSON_PATH` | 字段提取 | 从事件数据中提取指定字段 |
| `TEMPLATE` | 结构拼装 | 使用 Mustache 模板引擎拼装输出 |
| `SCRIPT_REF` | 复杂逻辑 | 引用已发布脚本处理复杂转换 |

---

## 系统设置

系统设置提供平台级别的配置、安全和数据管理功能。

### 配置值

路径：管理台 → 设置 → 配置值

全局配置值存储，用于管理 API Key、连接字符串等配置。

表格列：

| 列 | 说明 |
|----|------|
| Key | 配置键名（唯一） |
| Value | 配置值（Secret 类型会脱敏显示） |
| Has Value | 是否有值 |
| 来源 | 手动创建或仓库默认值 |

创建/编辑字段：

| 字段 | 说明 |
|------|------|
| Key | 唯一配置键名 |
| Value | 配置值（支持模板语法） |
| 描述 | 配置用途说明 |
| Secret | 标记为敏感值（在日志和 UI 中脱敏） |

详情页标签：

- 概览：键名、值、描述、Secret 状态、创建/更新时间
- 影响：哪些脚本和资源引用了此配置值
- 引用：反向依赖分析

仓库默认值操作：

- 复制为本地覆盖：在仓库默认值基础上创建本地覆盖
- 恢复仓库默认：回到仓库原始默认值

### 共享状态

路径：管理台 → 设置 → 共享状态

跨脚本共享的键值存储，支持命名空间隔离。

特性：

- `namespace + key` 组织状态，不同脚本按命名空间隔离
- `secret` 标记敏感数据，日志中自动脱敏
- `expiresAt` 支持临时数据自动过期
- `version` 版本号和 CAS（Compare-And-Swap）乐观锁
- 自动追踪 `lastWriterScriptId` / `lastWriterExecutionId`

命名空间浏览器：切换不同命名空间查看条目。

表格列：

| 列 | 说明 |
|----|------|
| Key | 状态键名 |
| Value 预览 | 值的摘要（Secret 类型脱敏） |
| 版本 | 当前版本号 |
| Secret | 是否为敏感值 |
| 过期时间 | TTL 到期时间 |
| 最后写入者 | 最后修改的脚本/执行 |

操作：

- 创建/更新条目（JSON 编辑器）
- CAS 更新（并发安全）
- 清理过期条目
- 复制代码片段（Groovy / Python / CLI 格式的 `state.get()`、`state.put()` 等调用代码）

### 访问令牌

路径：管理台 → 设置 → 访问令牌

管理用于 API 认证的 Bearer Token。

表格列：

| 列 | 说明 |
|----|------|
| Token ID | 令牌标识 |
| 名称 | 人类可读名称 |
| Token 值 | 脱敏显示，提供复制按钮 |
| 启用状态 | 是否启用 |
| 创建时间 | 创建时间戳 |

操作：

- 创建令牌（创建后 Token 值只显示一次，请妥善保存）
- 启用/禁用令牌
- 删除令牌
- 设为控制台凭证（快速复制到浏览器会话）

### 控制台凭证

路径：管理台 → 设置 → 控制台凭证

配置当前浏览器会话使用的 Bearer Token。

- 输入 Token 后保存到浏览器本地存储
- 状态指示器显示是否已配置
- 清除凭证按钮
- 如果没有配置任何访问令牌，所有 API 请求不需要认证（开放模式）

### 数据备份与恢复

路径：管理台 → 设置 → 数据备份

#### 创建备份

- 概览表格显示各类型数据量（脚本、调度、事件源、事件触发、配置值、执行预设、仓库、插件、共享状态、AI 模型、AI Agent、AI Toolset、Skill 目标、Skills）
- 可勾选「包含 Secret 配置值和共享状态明文值」
- 点击「创建备份」下载 `.zip` 文件（包含 `backup.json` 及 `plugins/`、`skills/` 目录）

#### 恢复备份

- 注意：恢复操作会覆盖现有数据
- 上传 `.zip` 备份文件
- 预览弹窗分析：每种数据类型将创建多少、覆盖多少
- 确认后执行恢复
- 结果摘要：每种数据类型的成功/跳过/失败计数及错误详情

---

## 脚本编写指南

### 脚本结构基础

Groovy 脚本模板：

```groovy
// input 是一个 Map，包含调用方传入的参数
def name = input.name ?: "world"

// 返回一个 Map 作为输出
return [
    greeting: "Hello, ${name}!",
    timestamp: System.currentTimeMillis()
]
```

Python 脚本模板：

```python
# input 是一个 dict，包含调用方传入的参数
name = input.get("name", "world")

# 返回一个 dict 作为输出
return {
    "greeting": f"Hello, {name}!",
    "timestamp": int(time.time() * 1000)
}
```

语言选择建议：

- 需要快速脚本、Java 生态集成、简单逻辑 → Groovy
- 需要 Python 生态库、数据处理、ML 推理 → Python

### 输入输出 Schema

`inputSchema` 和 `outputSchema` 使用 JSON Schema 格式定义。

Schema 一次声明，四处生效：

- CLI：自动展平为 `--name alice` 形式的 flag
- Admin UI：自动生成参数填写表单
- AI Agent：自动理解为 tool description
- 执行校验：执行前自动校验入参格式

Schema Builder：管理台提供可视化 Schema 编辑器，支持字段添加、类型选择、必填设置等。

### 依赖声明

脚本依赖（调用其他脚本）：

在脚本的依赖声明中添加对其他已发布脚本的引用，然后在代码中调用：

```groovy
def result = scripts.invoke("other-script", [name: "world"])
```

跨语言透明调用：Groovy 调 Python、Python 调 Groovy 均可，路由由平台处理。

插件依赖：声明所需插件及其 Action，确保运行时插件已安装。

AI 依赖：声明所需 AI 能力，如 CHAT、STRUCTURED_OUTPUT。

### 运行时 API

#### 调用其他脚本

```groovy
// Groovy
def result = scripts.invoke("target-script-id", [param1: "value1"])
```

```python
# Python
result = scripts.invoke("target-script-id", {"param1": "value1"})
```

#### 调用插件

```groovy
// Groovy
def result = plugins.invoke("my-plugin", "action-name", [key: "value"])
```

```python
# Python
result = scripts.invoke("my-plugin", "action-name", {"key": "value"})
```

#### 调用 AI

通过内置系统插件 `actiondock-ai`：

```groovy
// Groovy
def chatResult = plugins.invoke("actiondock-ai", "chat", [
    modelProfileId: "my-model",
    messages: [[role: "user", content: "Hello"]]
])
```

支持的 AI Action：`chat`、`structured`、`embed`、`agentRun`。

#### 共享状态

```groovy
// Groovy
def value = state.get("my-namespace", "my-key")
state.put("my-namespace", "my-key", [data: "value"])
state.cas("my-namespace", "my-key", [data: "new"], 3)  // version=3
def entries = state.list("my-namespace")
```

```python
# Python
value = state.get("my-namespace", "my-key")
state.put("my-namespace", "my-key", {"data": "value"})
entries = state.list("my-namespace")
```

### Python 脚本专属

第三方依赖：在 `pythonRequirements` 字段中声明，等同于 `requirements.txt` 格式。平台会自动将依赖安装到隔离缓存目录。

Python 可用标准库：所有 Python 标准库模块均可直接使用。

---

## CLI 速查

### 安装

```bash
npm install -g actiondock
```

### 配置

```bash
actiondock config set server <url>       # 设置服务器地址
actiondock config set token <token>     # 设置访问令牌
actiondock config show                   # 查看当前配置
```

环境变量方式：`ACTIONDOCK_BASE_URL`、`ACTIONDOCK_TOKEN`。

### 脚本命令

```bash
# 查看脚本列表
actiondock script list
actiondock script list --all

# 查看 Schema
actiondock script schema <script-id>

# 执行脚本
actiondock script run <script-id> --param1 value1 --json
actiondock script run <script-id> --draft --response-view debug

# 创建脚本
actiondock script create --script-id <id> --name <name> --type groovy --source-file <path>

# 更新脚本
actiondock script patch <id> --source-file <path>

# 校验脚本
actiondock script validate <id>

# 发布脚本
actiondock script publish <id>
```

### 服务管理

```bash
actiondock desktop           # 启动桌面模式（打开管理台 + 系统托盘）
actiondock server            # 前台启动服务
actiondock service install   # 安装为系统服务
actiondock service start     # 启动服务
actiondock service status    # 查看状态
actiondock service stop      # 停止服务
actiondock service uninstall # 卸载系统服务
```

### Schema 驱动的 CLI 参数

CLI 会自动将 `inputSchema` 展平为 flag 形式：

```bash
# 如果 Schema 定义了 name (string) 和 age (integer)
actiondock script run my-script --name alice --age 30 --json
```

能展开成 flag 的字段自动展开，对象和数组使用 `--input-json` 或文件输入。

---

## API 概览与常见问题

### API 访问

- Base URL：`http://localhost:5177/api`
- Swagger UI：`http://localhost:5177/swagger-ui.html`
- 认证方式：`Authorization: Bearer <token>` 请求头
- 开放模式：如果没有配置任何访问令牌，所有 API 请求不需要认证

### 主要端点分类

| 类别 | 端点 | 说明 |
|------|------|------|
| 脚本 | `/api/scripts` | 脚本 CRUD、发布、执行 |
| 能力 | `/api/capabilities` | 统一能力入口 |
| 执行 | `/api/executions` | 执行记录管理 |
| 插件 | `/api/plugins` | 插件生命周期管理 |
| 仓库 | `/api/repositories` | 仓库 CRUD、同步、安装 |
| 定时 | `/api/schedules` | 定时任务管理 |
| 共享状态 | `/api/shared-state` | 跨脚本状态管理 |
| 配置值 | `/api/config-values` | 全局配置管理 |
| 访问令牌 | `/api/access-tokens` | Token 管理 |
| 事件源 | `/api/event-sources` | 事件源管理（`POST /events` 不需要认证） |
| 事件触发 | `/api/event-triggers` | 触发规则管理 |
| 事件记录 | `/api/event-records` | 事件历史查询 |
| Skills | `/api/skills` | Skill 安装与管理 |
| AI 模型 | `/api/ai/models` | 模型配置管理 |
| AI Agent | `/api/ai/agents` | Agent 配置与运行 |
| AI Toolset | `/api/ai/toolsets` | 工具集管理 |
| AI 网关 | `/api/ai/chat`、`/api/ai/structured`、`/api/ai/embed` | 直接 AI 调用 |

### 常见问题

脚本相关：

- 脚本校验失败：检查 Schema 格式是否正确，必填字段是否完整
- 草稿执行 vs 发布执行：使用 `--draft` 或 `draft: true` 执行草稿版本
- 依赖找不到：确认被依赖的脚本已发布，插件已安装

插件相关：

- 插件启动失败：检查 JAR 是否符合 PF4J 规范，Manifest 是否正确
- 插件版本冲突：更新时如果版本冲突，需要先卸载再安装

事件框架相关：

- 事件没进来：检查 Webhook 地址是否正确、鉴权配置是否匹配
- 触发器不命中：检查过滤处理器的 `matched` 输出是否为 `true`
- 重复触发：检查幂等处理器的 `key` 是否稳定
- 目标脚本必须已发布：保存事件触发时，目标脚本必须是 PUBLISHED 状态

AI 相关：

- 模型测试失败：检查 API Key 配置是否正确（Config Value 中的值）
- OLLAMA 不需要 API Key：使用 OLLAMA 供应商时可以不配置 API Key
- Agent 运行失败：检查 Toolset 中引用的工具是否存在且已启用

仓库相关：

- 同步失败：检查网络连接、Git 认证、分支名是否正确
- 开发脚本冲突：`DIVERGED` 状态表示本地和远程都有修改，需要手动处理

### 术语表

| 术语 | 说明 |
|------|------|
| Script Definition | 脚本定义，包含源码、Schema、依赖等完整元数据 |
| Published Snapshot | 发布快照，脚本发布时产生的不可变版本 |
| Draft | 草稿，可自由编辑的脚本版本 |
| Scope（作用域） | `PERSONAL`（个人）/ `REPOSITORY`（仓库）/ `FORK`（Fork）/ `DEVELOPMENT`（开发）/ `SAMPLE`（示例） |
| Packaging（打包类型） | `TOOL`（工具型，单次调用）/ `FLOW`（流程型，可能包含多步骤） |
| Plugin | 插件，基于 PF4J 的扩展模块 |
| Repository | 仓库，脚本/插件/Skills 的分发来源 |
| Toolset | 工具集，Agent 可使用的一组工具 |
| Agent Profile | Agent 配置，定义 AI Agent 的模型、提示词、工具 |
| Model Profile | 模型配置，定义 AI 模型的供应商、名称、API Key |
| Event Source | 事件源，外部系统的接入口 |
| Event Trigger | 事件触发，事件到脚本的路由规则 |
| Processor | 处理器，数据转换逻辑（`JSON_PATH` / `TEMPLATE` / `SCRIPT_REF`） |
| Config Value | 配置值，全局键值配置 |
| Shared State | 共享状态，跨脚本的键值存储 |
| CAS | Compare-And-Swap，乐观锁机制 |
| Access Token | 访问令牌，API 认证凭证 |
| Skill | 技能包，可安装到目标目录的功能包 |
| Skill Target | 技能目标，Skill 安装的目录 |
| Execution Preset | 执行预设，保存的常用输入参数组合 |
| Submit Mode | 提交模式，`SYNC`（同步）/ `ASYNC`（异步） |
