# Document Set Planning：子文档清单规划

本文件定义 Planner 在生成写入任务前必须完成的“子文档清单规划”。它解决的问题不是单篇文章怎么写，而是某个分类下**应该有哪些 leaf docs 存在**。

核心原则：

```text
Plan the document set before writing document tasks.
```

中文原则：

```text
先规划子文档清单，再生成写入任务。
```

## 1. Planner 的新增职责

Planner 不只输出 `tasks`。每个激活 domain 必须先输出 `document_set_plan`，再输出 `tasks`。

`document_set_plan` 用来回答：

- 这个分类下应该有哪些 leaf docs？
- 哪些已经存在，需要更新？
- 哪些缺失，本轮必须创建？
- 哪些候选文档证据不足，应该 defer？
- 哪些旧文档可能重复、过期或应进入 deprecate / prune candidate？
- 哪个 index/navigation doc 负责链接这些 leaf docs？

Planner 不能把“需要哪些子文档”的判断交给 Worker。Worker 只能执行 Planner 明确下发的 target_path 任务。

## 2. 输出结构

Planner 输出必须包含：

```json
{
  "document_set_plan": [],
  "tasks": [],
  "skipped": []
}
```

每个 `document_set_plan` item 应包含：

```json
{
  "category": "business_flows",
  "domain": "Business_Flow_Planner",
  "index_path": "docs/domain/flows/index.md",
  "planning_basis": ["src/orders/checkout.service.ts"],
  "leaf_docs": [
    {
      "path": "docs/domain/flows/order-checkout.md",
      "title": "Order Checkout Flow",
      "status": "create",
      "priority": "must",
      "reason": "Checkout crosses order, payment, and inventory modules.",
      "evidence_paths": ["src/orders/checkout.service.ts"]
    }
  ],
  "index_policy": "index links to leaf docs only; do not store flow bodies here"
}
```

## 3. Leaf doc 状态

`leaf_docs[].status` 必须使用以下值：

- `create`：证据支持，本轮应创建。
- `update`：已有 leaf doc，本轮应更新。
- `keep`：已有 leaf doc，当前证据显示无需修改。
- `defer`：可能需要，但本轮证据不足或不在 scope 内；必须写 `defer_reason`。
- `deprecate`：旧文档仍有历史或迁移价值，应标记弃用而不是删除。
- `prune_candidate`：疑似可删除，但必须由路径安全、引用检查和人工内容保护规则确认。

`leaf_docs[].priority` 必须使用：

- `must`：当前变更或初始化范围内必须存在或必须明确 defer。
- `should`：建议存在，但证据不足时可 defer。
- `candidate`：候选项，只记录规划，不生成写入任务。

## 4. 从 document_set_plan 到 tasks

Planner 必须将 `priority=must` 且 `status=create|update|deprecate` 的 leaf doc 转成具体 `UPSERT` 任务。

每个由子文档规划产生的任务必须带：

```json
{
  "from_document_set_plan": "business_flows",
  "document_set_item_path": "docs/domain/flows/order-checkout.md"
}
```

如果创建或更新 leaf doc，也必须创建或更新对应 index/navigation 任务，确保 index 链接它。index 任务应带：

```json
{
  "doc_kind": "navigation",
  "index_update_for": "docs/domain/flows/order-checkout.md"
}
```

Worker 不得创建 `document_set_plan` 之外的额外 leaf docs；如果 Worker 发现需要新的 leaf doc，应失败或在 warnings 中要求 Planner 增补任务。

## 5. 各分类的子文档规划规则

### Business Flow

分类：`business_flows`  
索引：`docs/domain/flows/index.md`

每个主流程一个 leaf doc：

- `docs/domain/flows/order-checkout.md`
- `docs/domain/flows/payment-refund.md`
- `docs/domain/flows/user-registration.md`
- `docs/domain/flows/inventory-reservation.md`
- `docs/domain/flows/subscription-renewal.md`

必须拆分的信号：流程跨越多个 service、controller、job、event、table、外部依赖，或有独立状态变化/失败路径。

### API / Integration

分类：`api_http_resources`、`api_event_families`、`integrations`  
索引：`docs/api/http.md`、`docs/api/events.md`

每个 API resource、API version 或事件族一个 leaf doc：

- `docs/api/http/auth.md`
- `docs/api/http/orders.md`
- `docs/api/http/payments.md`
- `docs/api/http/webhooks.md`
- `docs/api/events/payment-events.md`
- `docs/api/compatibility.md`

一个 resource group 有多个 endpoint，或出现 version / breaking change，就必须独立成文。

### Data

分类：`data_tables`、`data_transactions`  
索引：`docs/data/index.md`

核心表和跨表事务必须独立：

- `docs/data/tables/users.md`
- `docs/data/tables/orders.md`
- `docs/data/tables/payments.md`
- `docs/data/transactions/checkout.md`
- `docs/data/transactions/refund.md`

migration 是证据，不等于最终事实。表文档应以当前 schema / ORM / DDL 事实为主。

### Infra / Config

分类：`config_domains`  
索引：`docs/ops/config/index.md`

每个配置域或外部依赖一个 leaf doc：

- `docs/ops/config/auth.md`
- `docs/ops/config/database.md`
- `docs/ops/config/redis.md`
- `docs/ops/config/payment-provider.md`
- `docs/ops/config/feature-flags.md`

同一组 env/config 控制同一个能力或外部服务时，必须独立成文。

### Ops / Diagnosis

分类：`runbooks`、`diagnosis_paths`  
索引：`docs/diagnosis/index.md` 或运维入口。

每个人工操作或故障类型一个 leaf doc：

- `docs/ops/maintenance/retry-failed-payments.md`
- `docs/ops/maintenance/rebuild-search-index.md`
- `docs/diagnosis/payment-timeout.md`
- `docs/diagnosis/queue-lag.md`
- `docs/diagnosis/webhook-delivery-failure.md`

只要包含前置检查、操作步骤、验证方式、回滚方式、症状、检查步骤或修复步骤，就必须独立成文。

### Services / Packages

分类：`services`、`packages`  
索引：`docs/code/workspaces.md`

monorepo / multi-service 项目里，每个 deployable service 或共享 package 必须独立成文：

- `docs/services/auth.md`
- `docs/services/billing.md`
- `docs/services/notification.md`
- `docs/packages/shared-db.md`
- `docs/packages/ui.md`

被多个 app/service 依赖的 package 必须优先独立成文；不把 package 细节全部塞进 workspace 索引。

## 6. defer 规则

Planner 不应为了“完整”而创建空文档。

如果识别到潜在子文档，但证据不足，应在 `document_set_plan.leaf_docs` 中记录：

```json
{
  "path": "docs/domain/flows/inventory-reservation.md",
  "status": "defer",
  "priority": "should",
  "reason": "Detected inventory service name, but no flow entry point in current evidence.",
  "defer_reason": "insufficient_evidence"
}
```

`defer` 项不生成 Worker 写入任务，但 Validator 和 report 应保留它，方便后续补全。

## 7. Validator 对 document_set_plan 的检查

Validator 必须检查：

- `priority=must` 且 `status=create|update|deprecate` 的 leaf docs 是否有对应任务和文件结果。
- `status=defer` 是否有 `defer_reason`。
- index 是否链接已创建或更新的 must leaf docs。
- 是否出现 `index_without_leaf_docs`：有 index 项但没有对应 leaf doc。
- 是否出现 `category_under_split`：多个独立流程 / API / 配置 / 诊断被挤在一个文档里。
- Worker 是否创建了 Planner `document_set_plan` 之外的 leaf doc。

新增 finding types：

- `missing_required_leaf_doc`
- `index_without_leaf_docs`
- `category_under_split`
- `document_set_plan_missing`
- `unplanned_leaf_doc`

## 8. 与 document-granularity.md 的关系

- `document-granularity.md` 规定：正文不能写进 index，必须拆到 leaf docs。
- `document-set-planning.md` 规定：每个分类下应该有哪些 leaf docs，以及本轮创建/更新/保留/延后哪些。

二者必须一起使用：先规划文档集合，再保证 index 只做导航。
