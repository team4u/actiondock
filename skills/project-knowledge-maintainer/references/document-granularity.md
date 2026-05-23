# Document Granularity：文档颗粒度规则

本文件用于防止知识库把长期事实堆进 `index.md`、`http.md`、`workspaces.md` 等综合入口页。核心原则：

```text
Index is navigation-only.
Leaf docs carry durable project knowledge.
```

中文原则：

```text
索引页只做导航。
正文页承载长期知识。
```

## 1. 文档类型

### Navigation / Index Doc

只做目录、入口、状态总览和链接组织。典型文件：

- `ACTIONDOCK.md`
- `docs/code/index.md`
- `docs/code/workspaces.md`
- `docs/api/http.md`（当作为 HTTP API 总入口时）
- `docs/api/events.md`（当作为事件总入口时）
- `docs/data/index.md`
- `docs/domain/flows/index.md`
- `docs/ops/config/index.md`
- `docs/diagnosis/index.md`

允许内容：

- 一句话范围说明。
- 已建立文档链接。
- 待建立 / 暂无证据 / 不适用状态。
- 简短维护备注。
- 指向 leaf doc 的分组索引。

禁止内容：

- 完整业务流程步骤。
- 完整 API schema 或请求/响应字段表。
- 完整数据库字段目录。
- 具体 runbook 或故障排障步骤。
- 详细状态机。
- 多个实体的长正文。
- 长篇 `证据与边界`。

### Leaf Substantive Doc

承载长期项目事实的正文档。典型文件：

- `docs/domain/flows/order-checkout.md`
- `docs/domain/state-machines/order-status.md`
- `docs/api/http/orders.md`
- `docs/api/events/payment-events.md`
- `docs/data/tables/orders.md`
- `docs/data/transactions/checkout.md`
- `docs/ops/config/payment-provider.md`
- `docs/diagnosis/payment-timeout.md`
- `docs/ops/maintenance/retry-failed-payments.md`
- `docs/services/billing.md`
- `docs/packages/shared-db.md`

要求：

- 包含当前行为、关键文件、维护边界。
- 必须包含 `证据与边界` 或 `Evidence and Boundaries`。
- 如果内容涉及流程、状态、接口、表、配置、诊断或 runbook，默认应该是 leaf doc。

## 2. 强制拆分触发条件

Planner 必须创建或更新 leaf substantive doc，而不是把正文写进 `index.md`，当变更引入或修改：

- 命名业务流程，例如 checkout、refund、registration、approval。
- 命名状态机，例如 order status、job lifecycle。
- API 资源组或 API version，例如 orders、payments、v2。
- 事件 topic / payload / consumer contract。
- 数据库核心表。
- 跨表事务或数据一致性流程。
- 配置域，例如 auth、database、redis、payment provider。
- 外部依赖或集成。
- runbook、人工操作或诊断路径。
- monorepo 中的 service 或 package。
- breaking change 的迁移路径。

如果当前只有 `index.md` 存在，Planner 必须：

1. 创建对应 leaf doc 任务；
2. 再创建或更新 index doc 任务，只添加链接和简短说明；
3. 不得把完整正文追加到 index doc。

## 3. 各领域拆分建议

### Business Flow

- `docs/domain/flows/index.md`：只列流程入口。
- `docs/domain/flows/<flow-name>.md`：每个主业务流程一个文档。
- `docs/domain/state-machines/<machine-name>.md`：每个主状态机一个文档。

### Data

- `docs/data/index.md`：只列数据域入口。
- `docs/data/schema.md`：全局 schema 总览，不写所有字段细节。
- `docs/data/tables/<table>.md`：每个核心表一个文档。
- `docs/data/transactions/<transaction>.md`：每个跨表事务一个文档。

### API / Integration

- `docs/api/http.md`：HTTP API 入口。
- `docs/api/http/<resource>.md`：每个 API 资源组一个文档。
- `docs/api/events.md`：事件入口。
- `docs/api/events/<event-family>.md`：每个事件族一个文档。
- `docs/api/compatibility.md`：breaking / versioned API 兼容性。

### Infra / Config

- `docs/ops/config/index.md`：配置入口。
- `docs/ops/config/<config-domain>.md`：每个配置域一个文档。
- `docs/ops/dependencies.md`：依赖总览；复杂外部依赖可拆到 `docs/integrations/<provider>.md`。

### Ops / Diagnosis

- `docs/diagnosis/index.md`：诊断入口。
- `docs/diagnosis/<symptom-or-failure>.md`：每个故障类型一个文档。
- `docs/ops/maintenance/<operation>.md`：每个人工操作或维护流程一个 runbook。

### Services / Packages

- `docs/code/workspaces.md`：workspace/service/package 总览。
- `docs/services/<service>.md`：每个核心服务一个文档。
- `docs/packages/<package>.md`：每个核心 package 一个文档。

## 4. Index 内容上限

Index doc 应保持短小。出现以下任一信号时，Validator 应报告 `index_content_sink`：

- 一个 `index.md` 下出现 3 个以上具体业务实体的 H2/H3 正文段落。
- 出现完整流程步骤，例如 “步骤 1/2/3”、长 Mermaid 流程图、状态迁移表。
- 出现 API 请求/响应字段表。
- 出现数据库字段目录。
- 出现具体排障步骤、命令序列或回滚步骤。
- 出现多个配置域的详细 env 表。
- 正文长度显著超过导航需要，并且没有拆到 leaf docs。

严重程度：

- `warning`：index 有少量正文，但未形成主要事实来源。
- `error`：index 承载多个具体流程、实体、接口、配置、runbook 或诊断，已经替代 leaf docs。

## 5. 命名规则

Leaf doc 路径应稳定、可读、可维护：

- 使用 kebab-case。
- 以业务实体或资源命名，不以临时代码路径命名。
- 名称应能长期承载知识，不依赖一次性任务名。

示例：

- 好：`docs/domain/flows/payment-refund.md`
- 好：`docs/api/http/orders.md`
- 好：`docs/ops/config/redis.md`
- 避免：`docs/domain/flows/index.md` 承载所有 payment/order/user 流程
- 避免：`docs/api/http.md` 承载所有接口详情
- 避免：`docs/ops/config/index.md` 承载所有 env 变量细节


## 6. 与 document-set-planning.md 的关系

本文件规定 index 与 leaf doc 的颗粒度边界；`document-set-planning.md` 规定每个分类应该有哪些 leaf docs。

执行顺序：

1. Planner 先用 `document-set-planning.md` 输出 `document_set_plan`。
2. Planner 再用本文件检查每个 leaf doc 是否应独立成文、每个 index 是否只做导航。
3. Worker 只执行 Planner 规划的 leaf/index tasks。
4. Validator 同时检查 `index_content_sink` 和 `missing_required_leaf_doc`。
