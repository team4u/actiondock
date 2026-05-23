# ACTIONDOCK 模板

创建或刷新 `ACTIONDOCK.md` 时使用该结构。可以保留项目已有的有用链接和说明，但以下核心区块应保持稳定。

关键原则：**只在“已建立”中链接真实存在或本轮即将创建的文档**。不要为了模板完整性制造断链。没有证据或不适用的主题放入“待建立 / 不适用”。

```md
# ACTIONDOCK

## 项目知识索引

### 已建立

<!-- 只放真实存在或本轮创建的正式文档。例如：
- 架构总览：[docs/code/architecture.md](docs/code/architecture.md)
- 本地开发与测试：[docs/dev/local-dev.md](docs/dev/local-dev.md)
-->

### 待建立 / 暂无证据

- HTTP API：暂无仓库证据或尚未整理。
- 事件与异步契约：暂无仓库证据或尚未整理。
- 数据模型：暂无仓库证据或尚未整理。
- 业务流程：暂无仓库证据或尚未整理。
- 工具与 Agent 上下文：暂无仓库证据或尚未整理。
- 运维与诊断：暂无仓库证据或尚未整理。

### 明确不适用

- 例如：GraphQL API：本项目未使用 GraphQL。

## 最近一次维护

- Operation mode:
- Execution mode:
- Flow profile:
- Serial fallback reason:
- Git baseline:
- Changed files:
- Report:

## 场景标记

- Scale:
- Change types:
- Workspace scope:
- Special flags:

## 已知证据缺口

- ...

## 维护备注

- ...
```

## 链接规则

- `已建立` 只放存在的正式文档，或本次 Apply 阶段已经创建的正式文档。
- `待建立 / 暂无证据` 不使用 Markdown 链接，避免初始化后立即断链。
- `明确不适用` 需要有仓库证据，例如没有相关依赖、路由、schema、worker 或部署配置。
- 如果索引页本身没有 `证据与边界`，它必须链接到至少一个含有证据区的正文档，或明确说明当前没有已建立正文档。


## 模板使用约束

- `ACTIONDOCK.md` 只做入口，不承载完整业务流程、接口 schema、数据表字段、runbook 或诊断步骤。
- 已建立区只链接真实存在或本轮创建的 leaf docs / 入口 docs。
- 待建立 / 暂无证据 / 不适用区不要使用 Markdown 链接。
- 如果发现某个领域只有 index，但本次新增具体流程/接口/配置/诊断，应创建 leaf doc 后再链接。
