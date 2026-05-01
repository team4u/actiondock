# ActionDock

**ActionDock** 是一套把脚本、插件、仓库分发、AI 调用和运行治理放进同一运行体系的工具平台。

它解决的不是“怎么再多跑几个脚本”，而是怎么把零散脚本升级成团队可复用、可分发、可审计、可被 AI 稳定调用的脚本资产。

一句话概括：

> **同一份脚本定义，可以同时被人、REST API、CLI 和 Agent 使用。**

## 为什么值得团队采用

很多团队都有类似问题：

- 脚本散落在个人目录、Jenkins、Cron、机器人配置里，没人知道哪份是最新
- 接给 AI 的“工具”缺少稳定契约，参数靠 prompt 猜，调用结果也不统一
- 配置、Token、游标、水位线各自落文件或塞数据库，跨脚本复用困难
- 一旦要团队协作，就会碰到发布、回滚、依赖、权限、审计和分发问题

ActionDock 的价值在于，它把这些问题收敛到同一平台能力里：

- **统一脚本抽象**：脚本不是一段源码，而是带 `Schema`、发布快照、依赖、日志和执行入口的脚本资产
- **多入口复用**：同一个脚本可被管理台、REST API、CLI、Agent 复用，不需要为不同入口各写一套适配
- **仓库化协作**：脚本、插件、AI 能力包可从仓库发现、安装、更新，也支持同步成开发脚本继续演进
- **AI 原生集成**：既能把平台脚本暴露给 Agent，也能用 AI 做脚本生成、诊断、Review 和发布辅助
- **治理能力完整**：内置配置值、共享状态、访问令牌、执行记录、定时任务、备份恢复，不再靠外围拼装

## 它和普通脚本平台的区别

| 维度 | 脚本目录 + cron | 只暴露 API 的脚本服务 | ActionDock |
|------|------------------|------------------------|------------|
| 工具输入输出契约 | 通常没有 | 需要手写 DTO / 文档 | 内建 `inputSchema` / `outputSchema` |
| 草稿与发布 | 通常没有 | 依赖额外发布流程 | 内建草稿、发布快照、丢弃草稿 |
| 团队分发 | 拷文件 / Git 约定 | 重新部署服务 | 仓库发现、安装、更新、开发同步 |
| 插件扩展 | 零散 SDK | 常需改主服务 | PF4J 插件机制，脚本侧统一调用 |
| AI 接入 | prompt 拼接 | 需额外接工具层 | AI Toolset、Agent、脚本桥接 |
| 共享状态治理 | 落文件 / Redis 自管 | 另接状态服务 | 内建共享状态 `namespace + key + JSON + version + CAS` |
| 多入口调用 | 各写各的 | API 为主 | UI、REST、CLI、Agent 共用同一脚本 |
| 审计与执行记录 | 弱 | 取决于实现 | 执行记录、日志、调试视图、触发来源内建 |

## 关键优势

### 脚本能力复用与跨语言编排

传统脚本是孤立的，互相之间没有调用机制。ActionDock 通过 `scripts.invoke()` 把脚本变成可组合的能力单元：

- **脚本间调用**：`scripts.invoke("target-id", args)` 让一个脚本成为另一个脚本的组合积木
- **跨语言透明调用**：Groovy 调 Python、Python 调 Groovy，路由由平台处理，调用方不关心对方用什么语言
- **循环调用检测**：自动检测并阻止脚本间的无限递归
- **发布版本锁定**：被调脚本强制走 published 版本，调用链始终稳定

传统 Java 时代复用靠 jar 依赖，脚本时代没有 jar——ActionDock 填补的就是这个空白。

### Schema 一次声明，四处生效

每个脚本的 `inputSchema` / `outputSchema` 不只是文档，而是驱动多个入口的元数据：

- CLI 自动展平为 `--name alice` 形式的 flag，不用手写 JSON
- Admin UI 自动生成参数填写表单
- AI Agent 自动理解为 tool description，无需额外 prompt 工程
- 执行前自动校验入参格式，契约违约在调用时就能发现

传统脚本参数全靠 README 口头约定，而 ActionDock 的 Schema 是机器可读、自动执行的契约。

### 草稿-发布-回滚，脚本也有版本控制

传统脚本改了就是改了，没有后悔药。ActionDock 提供完整的脚本生命周期：

- 草稿可以反复调试（`--draft` 执行），不影响线上版本
- 发布产生不可变快照，等价于给脚本打了一个稳定 tag
- 被调脚本和定时任务始终走 published 版本，不会因草稿改动而意外中断
- 草稿不满意可以 discard，一键回到上次发布版

比 git tag 更轻量，比手动备份更可靠。

### 跨脚本共享状态 + CAS 并发安全

传统方案里，同步游标、OAuth Token、水位线、批次号各自落文件或塞数据库，格式不统一，并发也不安全。

ActionDock 内建 `state` 门面，脚本直接 `state.get()` / `state.put()` 即可：

- `namespace + key` 组织状态，不同脚本按命名空间隔离
- `state.cas()` 提供乐观锁（Compare-And-Swap），解决并发写入冲突
- `secret` 标记敏感数据，日志中自动脱敏
- `expiresAt` 支持临时数据自动过期
- 自动追踪 `lastWriterScriptId` / `lastWriterExecutionId`，出了问题可追溯

脚本不需要自己管存储，不需要选型 Redis 还是数据库，直接用就行。

### 统一调用门面，插件和脚本无差别对待

对脚本来说，调用一个 Java 插件和调用另一个脚本，体验完全一致：

```groovy
// 调用插件
def result = plugins.invoke("my-plugin", "hello", [name: "world"])

// 调用另一个脚本
def result = scripts.invoke("other-script", [name: "world"])
```

调用方不关心底层是编译型插件还是解释型脚本，这是真正的面向接口组合——能力本身比实现形式更重要。

### AI 参与脚本全生命周期

不只是"脚本调 AI"，而是 AI 参与从开发到上线的每一步：

- **生成**：AI 根据需求生成脚本源码
- **补全**：AI 自动补全 `inputSchema` / `outputSchema`
- **校验**：语法检查 + Schema 一致性检查
- **调试**：`--draft` 执行 + `--response-view debug` 返回完整上下文
- **Review**：发布前 AI 审查脚本质量
- **诊断**：执行失败时 AI 分析原因并给出修复建议
- **发布说明**：AI 自动生成 Release Notes

CLI 的 `create/patch/validate/run --draft/publish` 命令设计天然适配 AI Agent 工作流，形成完整的自动化闭环。

### 仓库化分发——脚本领域的包管理器

传统做法是 Git clone 或文件共享，ActionDock 的仓库模型更接近包管理器：

- **发现**：浏览仓库目录，看到每个工具的 Schema、说明和依赖
- **安装**：一键安装到本地，自动创建 `REPOSITORY` 作用域
- **Fork**：安装后 fork 为个人脚本，自由修改
- **同步**：开发完成后同步回仓库，团队共享
- **更新**：上游有变更时可拉取更新，也可选择保留本地改动

脚本不再散落在各处，而是有正式的发现、安装、升级、回退流程。

### 零基础设施依赖，开箱即用

- 内嵌 H2 数据库，不需要额外安装 MySQL / PostgreSQL
- Groovy 引擎内嵌 JVM，不需要额外运行时（Python 类型脚本需要 python3）
- Docker Compose 一键启动完整服务
- npm 一行安装即可使用（`@actiondock/server`、`@actiondock/cli`）

团队不需要运维配合，5 分钟就能跑起来验证价值。

## 核心能力

### 1. 把脚本变成可治理的脚本资产

- 支持 `GROOVY` 和 `PYTHON` 两类脚本
- 每个脚本都带输入/输出 `Schema`
- 支持草稿编辑、校验、发布、发布快照执行、草稿回退
- 支持同步/异步执行、结果视图与调试视图
- 支持执行预设、执行记录、日志和错误详情

这意味着脚本调用不再靠 README 口头约定，而是有明确契约和稳定入口。

### 2. 团队协作与仓库分发

- 仓库类型支持 `LOCAL_DIR`、`GIT`、`HTTP`
- 仓库用途区分 `DISTRIBUTION` 和 `DEVELOPMENT`
- 可以浏览仓库中的脚本、插件、AI 能力包并按需安装或更新
- 已安装仓库脚本可以同步为本地开发脚本，继续修改、对比、再发布
- 支持 `PERSONAL`、`REPOSITORY`、`FORK`、`DEVELOPMENT`、`SAMPLE` 等脚本作用域

这套模型适合团队内部工具市场、公共脚本仓库、试点脚本孵化到正式纳管的全过程。

### 3. 插件机制，不把所有能力写死在脚本里

- 基于 PF4J 插件体系扩展平台能力
- 插件通过 Manifest 声明动作、Schema、配置和示例
- Groovy 和 Python 脚本都通过统一门面 `plugins.invoke(...)` 调用插件
- 插件可以单独打包、安装、升级，也可来自仓库分发

当脚本需要访问外部系统、封装内部 SDK 或沉淀共用能力时，不必把复杂逻辑都塞进脚本源码。

### 4. AI 不是外挂，而是平台内建能力

- 管理模型配置、Agent 配置、Toolset 和运行记录
- 可把平台内工具聚合成 Agent 可消费的工具集
- 内置 AI 能力，支持：
  - 生成脚本
  - 修复脚本
  - 补全 Schema
  - 诊断执行失败
  - 发布前 Review
  - 生成 Release Notes
- `actiondock-ai` 系统插件可让 Groovy 和 Python 脚本直接调用 `chat`、`structured`、`embed`、`agentRun`

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

- **脚本即入口**
- **仓库即分发渠道**
- **Schema 即调用契约**
- **AI 也是平台消费者，而不是旁路系统**

## 适合什么场景

- 团队里已经有很多内部脚本，想统一纳管、发布和复用
- 需要给 AI Agent 提供稳定、可审计、可配置的内部工具
- 需要维护 OAuth Token、同步游标、水位线、批次号等跨脚本共享状态
- 需要做“脚本仓库”而不是“脚本文件夹”，让安装、更新、开发同步都有正式流程
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

- 管理台：`http://localhost:5177/admin/app/scripts`
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
actiondock script run hello-groovy --name alice --json
```

## 分发形态

### 服务端

对外发布名为 `@actiondock/server`：

```bash
npm i -g @actiondock/server
actiondock-server
```

发布 npm 包：

```bash
cd actiondock-app-spring
npm run pack:dry-run
npm publish --access public
```

### 桌面安装包

发布 GitHub Release 或推送 `v*` tag 后，`.github/workflows/jdeploy.yml` 会构建桌面安装包：

```bash
gh release create v0.3.5 --target main --title "v0.3.5" --notes "ActionDock desktop release"
```

用户从 GitHub Releases 下载 `.exe`、`.dmg` 或 Linux 安装包，安装后双击 `ActionDock` 即可打开管理台并使用托盘入口。

### CLI

CLI 子项目发布名为 `@actiondock/cli`：

```bash
npm i -g @actiondock/cli
actiondock --help
```

CLI 的价值不只是“把 API 搬到终端”，而是把脚本 `Schema` 展平为更适合人和 Agent 调用的参数形式：

```bash
actiondock script run hello-groovy --name alice --json
```

能展开成普通 flag 的字段就不要求手写 JSON；对象和数组再回退到 `--input-json` 或文件输入。

如果你要让外部大模型持续生成并调试新脚本，推荐整个闭环都统一走 `script`：

```bash
actiondock script create --script-id hello-world --name "Hello World" --type groovy --source-file ./hello.groovy --json
actiondock script patch hello-world --source-file ./hello.v2.groovy --json
actiondock script validate hello-world --json
actiondock script run hello-world --draft --input-json '{"name":"alice"}' --response-view debug --json
actiondock script publish hello-world --json
```

- `script create/patch/validate/publish` 负责作者态操作
- `script run --draft` 负责调试草稿并返回结果

对应 REST API 里，调试更新建议优先走 `PATCH /api/scripts/{id}`，只允许更新 `source`、`inputSchema`、`outputSchema`，避免模型误覆盖整份脚本定义。

## 公开入口

常见入口包括：

- 管理台：`/admin/app/scripts`
- 脚本与执行：`/api/scripts`、`/api/executions`
- 插件与仓库：`/api/plugins`、`/api/repositories`
- 定时任务：`/api/schedules`
- 共享状态与配置：`/api/shared-state`、`/api/config-values`
- AI 能力：`/api/ai`
- CLI：`actiondock`

## 文档地图

根文档负责回答“它是什么、为什么值得引入、怎么最快试起来”。具体实现细节按模块拆分：

如果你只关心事件框架，先看 [事件框架配置指南](docs/event-framework.md)。

| 模块 | 说明 |
|------|------|
| [事件框架配置指南](docs/event-framework.md) | Event Source / Event Trigger / Processor / Event Record 的完整配置与排障流程 |
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
