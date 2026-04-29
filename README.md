# ActionDock

**ActionDock** 是一套把脚本、插件、仓库分发、AI 调用和运行治理放进同一运行体系的工具平台。

它解决的不是“怎么再多跑几个脚本”，而是怎么把零散脚本升级成团队可复用、可分发、可审计、可被 AI 稳定调用的工具资产。

一句话概括：

> **同一份工具定义，可以同时被人、REST API、CLI 和 Agent 使用。**

## 为什么值得团队采用

很多团队都有类似问题：

- 脚本散落在个人目录、Jenkins、Cron、机器人配置里，没人知道哪份是最新
- 接给 AI 的“工具”缺少稳定契约，参数靠 prompt 猜，调用结果也不统一
- 配置、Token、游标、水位线各自落文件或塞数据库，跨脚本复用困难
- 一旦要团队协作，就会碰到发布、回滚、依赖、权限、审计和分发问题

ActionDock 的价值在于，它把这些问题收敛到同一平台能力里：

- **统一工具抽象**：脚本不是一段源码，而是带 `Schema`、发布快照、依赖、日志和执行入口的工具
- **多入口复用**：同一个工具可被管理台、REST API、CLI、Agent 复用，不需要为不同入口各写一套适配
- **仓库化协作**：工具、插件、AI 能力包可从仓库发现、安装、更新，也支持同步成开发脚本继续演进
- **AI 原生集成**：既能把平台工具暴露给 Agent，也能用 AI Workbench 做脚本生成、诊断、Review 和发布辅助
- **治理能力完整**：内置配置值、共享状态、访问令牌、执行记录、定时任务、备份恢复，不再靠外围拼装

## 它和普通脚本平台的区别

| 维度 | 脚本目录 + cron | 只暴露 API 的脚本服务 | ActionDock |
|------|------------------|------------------------|------------|
| 工具输入输出契约 | 通常没有 | 需要手写 DTO / 文档 | 内建 `inputSchema` / `outputSchema` |
| 草稿与发布 | 通常没有 | 依赖额外发布流程 | 内建草稿、发布快照、丢弃草稿 |
| 团队分发 | 拷文件 / Git 约定 | 重新部署服务 | 仓库发现、安装、更新、开发同步 |
| 插件扩展 | 零散 SDK | 常需改主服务 | PF4J 插件机制，脚本侧统一调用 |
| AI 接入 | prompt 拼接 | 需额外接工具层 | AI Toolset、Agent、Workbench、脚本桥接 |
| 共享状态治理 | 落文件 / Redis 自管 | 另接状态服务 | 内建共享状态 `namespace + key + JSON + version + CAS` |
| 多入口调用 | 各写各的 | API 为主 | UI、REST、CLI、Agent 共用同一工具 |
| 审计与执行记录 | 弱 | 取决于实现 | 执行记录、日志、调试视图、触发来源内建 |

## 核心能力

### 1. 把脚本变成可治理的工具

- 支持 `GROOVY` 和 `PYTHON` 两类脚本
- 每个脚本都带输入/输出 `Schema`
- 支持草稿编辑、校验、发布、发布快照执行、草稿回退
- 支持同步/异步执行、结果视图与调试视图
- 支持执行预设、执行记录、日志和错误详情

这意味着工具调用不再靠 README 口头约定，而是有明确契约和稳定入口。

### 2. 团队协作与仓库分发

- 仓库类型支持 `LOCAL_DIR`、`GIT`、`HTTP`
- 仓库用途区分 `DISTRIBUTION` 和 `DEVELOPMENT`
- 可以浏览仓库中的工具、插件、AI 能力包并按需安装或更新
- 已安装仓库工具可以同步为本地开发脚本，继续修改、对比、再发布
- 支持 `PERSONAL`、`REPOSITORY`、`FORK`、`DEVELOPMENT`、`SAMPLE` 等脚本作用域

这套模型适合团队内部工具市场、公共脚本仓库、试点脚本孵化到正式纳管的全过程。

### 3. 插件机制，不把所有能力写死在脚本里

- 基于 PF4J 插件体系扩展平台能力
- 插件通过 Manifest 声明动作、Schema、配置和示例
- Groovy 脚本通过统一门面 `plugins.invoke(...)` 调用插件
- 插件可以单独打包、安装、升级，也可来自仓库分发

当脚本需要访问外部系统、封装内部 SDK 或沉淀共用能力时，不必把复杂逻辑都塞进脚本源码。

### 4. AI 不是外挂，而是平台内建能力

- 管理模型配置、Agent 配置、Toolset 和运行记录
- 可把平台内工具聚合成 Agent 可消费的工具集
- 内置 AI Workbench，支持：
  - 生成脚本
  - 修复脚本
  - 补全 Schema
  - 诊断执行失败
  - 发布前 Review
  - 生成 Release Notes
- `actiondock-ai` 系统插件可让 Groovy 脚本直接调用 `chat`、`structured`、`embed`、`agentRun`

当前 Provider 方向已包含 OpenAI、DashScope、Ollama、Gemini、Anthropic 的统一接入边界。

### 5. 运行治理能力是内建的

- **共享状态**：内建 `namespace + key + JSON value` 存储，支持 `secret`、`expiresAt`、`version` 和 CAS
- **配置值管理**：支持全局配置值、引用关系分析、模板来源恢复
- **访问控制**：支持访问令牌管理
- **定时任务**：支持全局和脚本级调度
- **备份恢复**：可导出脚本、调度、配置、仓库、插件、共享状态和 AI 配置

这使它更像“团队工具运行平台”，而不是单纯的脚本编辑器。

## 30 秒理解架构

```text
Script / Plugin / Repository / AI Package
                  |
                  v
         Define / Publish / Install / Sync
                  |
                  v
      ActionDock Runtime (Spring Boot + UI + CLI)
                  |
        +---------+----------+-----------+
        |                    |           |
        v                    v           v
    Admin UI             REST API      CLI / Agent
        |                    |           |
        +---------+----------+-----------+
                  |
                  v
    Execution / Logs / Schedules / Config / Shared State / AI Runs
```

核心理念是：

- **脚本即工具**
- **仓库即分发渠道**
- **Schema 即调用契约**
- **AI 也是平台消费者，而不是旁路系统**

## 适合什么场景

- 团队里已经有很多内部脚本，想统一纳管、发布和复用
- 需要给 AI Agent 提供稳定、可审计、可配置的内部工具
- 需要维护 OAuth Token、同步游标、水位线、批次号等跨脚本共享状态
- 需要做“工具仓库”而不是“脚本文件夹”，让安装、更新、开发同步都有正式流程
- 需要在脚本开发阶段就把 Review、诊断、发布说明这些辅助动作工具化

## 快速开始

### 前置要求

- JDK 21+
- Maven 3.9+
- Node.js 18+（前端或 CLI 开发需要）
- Python 3.x（执行 `PYTHON` 类型脚本需要，默认命令为 `python3`）

### 本地启动

```bash
# 编译全部模块
mvn clean package -DskipTests

# 启动服务
mvn -pl actiondock-app-spring -am spring-boot:run
```

启动后：

- 管理台：`http://localhost:5177/admin/scripts`
- API：`http://localhost:5177/api`

### Docker 启动

```bash
docker compose up -d --build
docker compose logs -f action-dock
docker compose down
```

### 试一个最小示例

服务默认会初始化示例脚本 `hello-groovy`。你可以直接调用：

```bash
curl -X POST http://localhost:5177/api/scripts/hello-groovy/published/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "name": "alice"
    },
    "mode": "SYNC"
  }'
```

如果更偏向终端或 AI 调用，可以直接使用 CLI：

```bash
actiondock tool run hello-groovy --name alice --json
```

## 分发形态

### 服务端

对外发布名为 `@actiondock/server`：

```bash
npm i -g @actiondock/server
actiondock-server
```

### CLI

CLI 子项目发布名为 `@actiondock/cli`：

```bash
npm i -g @actiondock/cli
actiondock --help
```

CLI 的价值不只是“把 API 搬到终端”，而是把工具 `Schema` 展平为更适合人和 Agent 调用的参数形式：

```bash
actiondock tool run hello-groovy --name alice --json
```

能展开成普通 flag 的字段就不要求手写 JSON；对象和数组再回退到 `--input-json` 或文件输入。

## 公开入口

常见入口包括：

- 管理台：`/admin/scripts`
- 脚本与执行：`/api/scripts`、`/api/executions`
- 插件与仓库：`/api/plugins`、`/api/repositories`
- 定时任务：`/api/schedules`
- 共享状态与配置：`/api/shared-state`、`/api/config-values`
- AI 能力：`/api/ai`、`/api/ai/workbench`
- CLI：`actiondock`

## 文档地图

根文档负责回答“它是什么、为什么值得引入、怎么最快试起来”。具体实现细节按模块拆分：

| 模块 | 说明 |
|------|------|
| [actiondock-app-spring](actiondock-app-spring/README.md) | Spring Boot Web 入口、REST API、管理台挂载方式 |
| [actiondock-admin-ui](actiondock-admin-ui/README.md) | React 管理台、页面结构、前端开发方式 |
| [actiondock-cli](actiondock-cli/README.md) | Node.js CLI，面向终端和 AI 的扁平命令入口 |
| [actiondock-core](actiondock-core/README.md) | 脚本平台核心领域模型、执行模型、仓库与发布规则 |
| [actiondock-app-support](actiondock-app-support/README.md) | 运行时装配、脚本引擎、插件运行时、仓库解析与默认配置 |
| [actiondock-plugin-api](actiondock-plugin-api/README.md) | PF4J 插件 SPI、Manifest 协议、脚本侧调用上下文 |
| [actiondock-plugin-template](actiondock-plugin-template/README.md) | 自定义插件模板与开发示例 |
| [actiondock-storage-jpa](actiondock-storage-jpa/README.md) | JPA/H2 持久化适配、实体与仓储实现 |
| [actiondock-ai-api](actiondock-ai-api/README.md) | AI 领域抽象：模型、Agent、Toolset、Tool、调用日志 |
| [actiondock-ai-core](actiondock-ai-core/README.md) | AI 核心服务与运行时编排 |
| [actiondock-ai-agentscope](actiondock-ai-agentscope/README.md) | 基于 AgentScope 的 Provider 实现与内置工具桥接 |
| [actiondock-ai-plugin-bridge](actiondock-ai-plugin-bridge/README.md) | 内置系统插件 `actiondock-ai` 与脚本中的 AI 调用方式 |

## 模块结构

```text
actiondock
├── actiondock-core
├── actiondock-ai-api
├── actiondock-ai-core
├── actiondock-ai-agentscope
├── actiondock-ai-plugin-bridge
├── actiondock-cli
├── actiondock-plugin-api
├── actiondock-plugin-template
├── actiondock-storage-jpa
├── actiondock-app-support
├── actiondock-app-spring
└── actiondock-admin-ui
```

## 建议阅读顺序

1. 先看 [actiondock-core](actiondock-core/README.md)，理解脚本平台的核心模型
2. 再看 [actiondock-app-support](actiondock-app-support/README.md)，理解运行时如何把脚本、插件、仓库和 AI 拼起来
3. 然后看 [actiondock-app-spring](actiondock-app-spring/README.md) 和 [actiondock-admin-ui](actiondock-admin-ui/README.md)，理解对外入口
4. 如果重点关注 AI，再看 [actiondock-ai-api](actiondock-ai-api/README.md)、[actiondock-ai-core](actiondock-ai-core/README.md)、[actiondock-ai-agentscope](actiondock-ai-agentscope/README.md)、[actiondock-ai-plugin-bridge](actiondock-ai-plugin-bridge/README.md)
5. 如果要扩展插件，再看 [actiondock-plugin-api](actiondock-plugin-api/README.md) 和 [actiondock-plugin-template](actiondock-plugin-template/README.md)
