# Document Set Planning：Plan A 子文档全集规划

`document_set_plan` 的作用是防止复杂更新被压成一个 index、总览页，或被 Planner 偷懒缩成一两个文件。它规划“某个分类下应该有哪些 leaf docs 存在”，不是规划单篇文档的标题大纲，也不是只列本轮最容易写的几个文件。

v4.4 起，`document_set_plan` 仍然是**规模和风险触发**的机制，不是所有任务的固定前置步骤。但一旦 `document_set_plan_required=true`，Planner 必须执行 **Plan A：完整预期文档集规划**。

核心规则：

```text
Plan A must enumerate the expected document set before any Worker runs.
Prefer over-inclusive defer/candidate items over under-planning.
Worker discovery is an overflow signal, not the primary planning mechanism.
```

中文规则：

```text
Plan A 先穷尽预期文档集；宁可多列 defer/candidate，也不能少列显然应有的 leaf docs。
Worker 只报告溢出，不承担补主计划的职责。
```

## 1. 何时必须使用

必须使用 `document_set_plan` 的情况：

- scale 为 `L` 或 `XL`。
- scale 为 `M` 且涉及新增或重大更新：
  - business flow
  - state machine
  - HTTP resource group
  - event family
  - integration contract
  - data table
  - data transaction
  - config domain
  - runbook
  - diagnosis path
  - service
  - package
- 目标是 index/navigation doc，但证据包含正文事实。
- 初始化非平凡仓库，需要建立多个正式 docs。
- ingest 多条 inbox 材料，或一条材料需要拆成 runbook / diagnosis / config / flow。
- Validator 报告 `index_content_sink`、`category_under_split`、`missing_required_leaf_doc`、`planner_underplanning` 或 `document_set_plan_missing_when_required`。
- 用户显式要求全面规划、Plan A、完整规划，或设置 `forceDocumentSetPlan=true`。

## 2. 何时可以省略

可以省略 `document_set_plan` 的情况：

- XS/S 只更新一个已存在 leaf doc。
- 只修复链接、导航、标题、状态、拼写或小段事实。
- 只更新 `ACTIONDOCK.md` 入口链接。
- validate-only 且 `repair=false`。
- 没有新实体、无 index 风险、无多文档拆分需求。

省略时，Planner 或主 agent 应在 reasoning/report 中简短说明：`document_set_plan_required=false`。

## 3. Plan A 完整性要求

当 `document_set_plan_required=true` 时，Planner 必须先做全集扫描，再给出任务。Planner 不得只列“马上能写的文件”，也不得写“其余由 Worker 发现 / 补充”。

每个激活 category 必须覆盖四类 leaf doc：

1. **existing**：该分类下已存在、仍相关、应 `keep`、`update`、`deprecate` 或 `prune_candidate` 的 leaf docs。
2. **must**：当前证据直接支持、当前范围内必须创建或更新的 leaf docs。
3. **should**：有明确结构信号或命名信号，但证据不足以本轮写正文的 leaf docs，通常 `status=defer`。
4. **candidate**：弱信号、未来可能需要、或 scope 外但相邻的 leaf docs，通常不生成任务。

Planner 必须显式写出：

- `coverage_basis`：用于推导文档全集的证据来源，例如 routes、controllers、migrations、services、packages、existing docs tree。
- `coverage_assertion`：一句话说明“本计划已覆盖当前 scope 下可识别的 leaf docs”。
- `scope_boundary`：明确本次没有覆盖什么，避免把局部计划伪装成全仓库全集。
- `excluded_candidates`：识别到但决定不纳入 leaf_docs 的候选项及理由；没有则写空数组。

这四项不是长推理，只是可验证的计划完整性声明。

## 4. 输出结构

推荐结构：

```json
{
  "document_set_plan": [
    {
      "category": "api_http_resources",
      "owner_domain": "API_Spec_Planner",
      "index_path": "docs/api/http.md",
      "reason": "新增 orders resource，入口页只做导航。",
      "coverage_basis": [
        "src/orders/orders.controller.ts",
        "src/payments/payments.controller.ts",
        "docs/api/http.md",
        "docs/api/http/"
      ],
      "coverage_assertion": "Plan A covers all HTTP resources visible in current router scope and existing API docs tree.",
      "scope_boundary": "Only orders and payments resources are in changed scope; admin routes are out of scope.",
      "excluded_candidates": [
        {
          "path": "docs/api/http/admin.md",
          "reason": "Existing route name detected, but no changed evidence and user scope excludes admin."
        }
      ],
      "leaf_docs": [
        {
          "path": "docs/api/http/orders.md",
          "title": "Orders HTTP API",
          "status": "create",
          "priority": "must",
          "reason": "orders endpoint 有独立 schema、权限和错误边界。",
          "evidence_paths": ["src/orders/orders.controller.ts"]
        },
        {
          "path": "docs/api/http/payments.md",
          "title": "Payments HTTP API",
          "status": "keep",
          "priority": "should",
          "reason": "payments leaf doc 已存在且未发现本轮变更。",
          "evidence_paths": ["docs/api/http/payments.md"]
        }
      ]
    }
  ],
  "tasks": [],
  "skipped": []
}
```

`leaf_docs[].status` 只能是：

- `create`
- `update`
- `keep`
- `defer`
- `deprecate`
- `prune_candidate`

`leaf_docs[].priority` 只能是：

- `must`
- `should`
- `candidate`

## 5. leaf doc 到 task 的转换

当 `document_set_plan_required=true` 时：

- `priority=must` 且 `status=create|update|deprecate` 的 leaf doc 必须转成具体 `UPSERT` 任务，或提供明确 `defer_reason`。
- `status=defer` 必须提供 `defer_reason`，不得创建空文档。
- `status=keep` 不需要写任务，除非 index/navigation 需要更新链接。
- `status=prune_candidate` 不自动删除；必须经过证据确认、链接检查和 PRUNE task。
- `priority=should|candidate` 可以不生成任务，但必须出现在 Plan A 中，不能让 Worker 自己发现。
- 从 document set plan 派生的任务应带：
  - `from_document_set_plan: true`
  - `document_set_item_path`
  - `doc_kind: substantive` 或 `navigation`

## 6. 禁止 Planner 偷懒

以下 Planner 输出视为违规：

- 只列 1-2 个 leaf docs，但 evidence 或 existing docs 明显显示还有同类实体。
- `reason`、`clue` 或 `skipped` 中写“其余由 Worker 发现 / 补充 / 自行判断”。
- 用单个 `docs/api/http.md`、`docs/domain/flows/index.md`、`docs/data/index.md` 等入口页覆盖多个具体实体。
- 没有读取 existing docs tree 就规划新文档，导致旧文档重复或遗漏。
- 对 monorepo / multi-service 只规划一个全局总览，不列受影响 service/package leaf docs。
- 把 `defer` 当作逃避：没有 `defer_reason`，或把有充分证据的 must doc 标成 `candidate`。

Validator 应将明显违规报告为 `planner_underplanning`；若 Planner 明确把发现职责交给 Worker，报告 `delegated_discovery_to_worker`。

## 7. 与 index/navigation 的关系

Index 或入口页只负责：

- 链接 leaf docs。
- 标记状态：已建立、待建立、暂无证据、不适用。
- 简短说明范围。
- 指向 ACTIONDOCK 或上级导航。

不得在 index/navigation 中写：

- 完整业务流程。
- 完整 API schema。
- 表字段目录。
- 多步骤 runbook。
- 诊断决策树。
- 多 service/package 的详细实现事实。

如果当前只有 index 存在，但任务需要写正文事实：

1. 创建或更新 leaf doc。
2. 更新 index 链接 leaf doc。
3. 不要用“已有 index”作为理由继续堆正文。

## 8. 常见分类

| 分类 | 推荐 leaf 路径 |
|---|---|
| `business_flows` | `docs/domain/flows/<flow-name>.md` |
| `state_machines` | `docs/domain/state-machines/<machine-name>.md` |
| `api_http_resources` | `docs/api/http/<resource>.md` |
| `api_event_families` | `docs/api/events/<event-family>.md` |
| `integrations` | `docs/integrations/<system>.md` |
| `data_tables` | `docs/data/tables/<table>.md` |
| `data_transactions` | `docs/data/transactions/<transaction>.md` |
| `config_domains` | `docs/ops/config/<config-domain>.md` |
| `runbooks` | `docs/ops/maintenance/<operation>.md` |
| `diagnosis_paths` | `docs/diagnosis/<symptom-or-failure>.md` |
| `services` | `docs/services/<service>.md` |
| `packages` | `docs/packages/<package>.md` |

## 9. Worker 发现漏拆时

Worker 不应强行把漏拆正文写进 index，也不应在 document_set_plan 生效时直接创建规划外 leaf doc。

Worker 可返回：

```json
{
  "status": "NEEDS_REPLAN",
  "target_path": "docs/api/http.md",
  "warnings": [
    "API 入口任务包含 orders resource 的正文 schema，应拆到 docs/api/http/orders.md。"
  ],
  "proposed_extra_tasks": [
    {
      "action": "UPSERT",
      "target_path": "docs/api/http/orders.md",
      "doc_kind": "substantive",
      "reason": "orders resource 有独立 schema 和行为边界。"
    }
  ]
}
```

但 `proposed_extra_tasks` 是**异常溢出机制**，不是正常规划机制。若 Worker 提出的是当前 evidence / existing docs tree 中显然可识别的 leaf doc，Validator 应同时报告 Planner `planner_underplanning`。serial 模式可以回到 mini-plan 补一轮；native_subagent 模式由 Leader 合并任务后派发新 Worker。

## 10. Validator 语义

Validator 只在 `document_set_plan_required=true` 时把缺失 document_set_plan 视为 error。

- XS/S 且无拆分风险：不要求 document_set_plan。
- M 且有新 leaf doc 风险：缺失为 warning 或 error，视影响范围决定。
- L/XL：缺失为 error。
- 已有 index 承载正文：报告 `index_content_sink`，建议拆分 leaf docs。
- 多个独立实体挤在一个文档：报告 `category_under_split`。
- Plan A 明显漏掉当前 scope 内可识别 leaf docs：报告 `planner_underplanning`。
- Planner 把文档发现职责交给 Worker：报告 `delegated_discovery_to_worker`。
