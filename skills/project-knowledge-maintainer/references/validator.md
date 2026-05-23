# Validator：自适应验证规则

Validator 只读。它可以生成 findings 和 report，但不得写入、删除或格式化正文档。只有用户明确要求修复，或输入 `repair=true`，才可触发后续 Plan/Apply。

## 1. 验证深度

### validate-lite

默认用于 XS/S 的变更后检查。覆盖：

- 本轮 changed targets。
- 相关入口链接。
- 新增或修改链接是否存在。
- substantive doc 是否包含 `证据与边界` 或 `Evidence and Boundaries`。
- navigation/index doc 是否没有明显承载正文。
- 是否出现明显 secret 值。
- target path 是否符合路径安全规则。

validate-lite 不承诺全仓库链接完整性。若发现影响超出 changed targets，应升级为 full validate。

### full validate

用于：

- M/L/XL。
- validate-only。
- repair=true。
- Validator 自身发现范围扩大。
- 用户要求全面检查。

覆盖基础检查和场景专项检查。

## 2. 基础检查

- `ACTIONDOCK.md` 是否存在。
- `ACTIONDOCK.md` 的“已建立”链接是否指向存在文件。
- `ACTIONDOCK.md` 的“待建立 / 暂无证据”项是否避免使用 Markdown 链接。
- docs 内部链接是否指向存在文件。
- substantive docs 是否包含 `证据与边界` 或 `Evidence and Boundaries`。
- navigation/index docs 是否链接到正文档，或明确说明暂无证据 / 不适用。
- docs 是否引用临时路径作为最终证据。
- 是否暴露明显 secret、token、private key 或完整敏感连接串。
- 是否错误要求 `.knowledge_base/` 布局。
- 是否违反路径安全。
- team_agent / native_subagent 模式下是否记录每个 changed substantive target 的 Worker delegate dispatch。

## 3. 文档颗粒度检查

### index_content_sink

当 navigation/index doc 承载多个具体实体正文时报告。

典型信号：

- 多个业务流程、API resource、表、配置域、runbook 或诊断路径挤在 index。
- 入口页出现完整字段表、schema、步骤列表或诊断树。
- index 成为事实主来源，leaf docs 缺失。

严重性：

- XS/S：warning，除非造成明显错误或 secret 暴露。
- M/L/XL：error。

### category_under_split

多个独立子文档应拆未拆时报告。

例子：

- 一个 `docs/domain/flows.md` 同时承载 checkout、refund、settlement 三条主流程。
- 一个 `docs/api/http.md` 同时承载 users、orders、payments 的完整 schema。
- 一个 `docs/ops/config/index.md` 承载 auth、billing、queue 三个配置域的详细说明。

### missing_required_leaf_doc

当 Router 或 document_set_plan 已确认必须存在 leaf doc，但任务或结果缺失时报告。

### document_set_plan_missing_when_required

只有在 `document_set_plan_required=true` 时报告。XS/S 且无拆分风险时，不报告该问题。

### unplanned_leaf_doc

当 document_set_plan 生效，但 Worker 创建了规划外 leaf doc 且没有 mini-plan / Leader 记录时报告。

### proposed_extra_task_unresolved

Worker 输出 `proposed_extra_tasks` 后，如果任务既未执行、未 defer，也未进入 evidence gap，则报告。


### document_set_plan_incomplete_metadata

当 `document_set_plan_required=true`，但某个 category 缺少 `coverage_basis`、`coverage_assertion`、`scope_boundary` 或 `excluded_candidates` 时报告。

严重度：warning；如果缺失导致无法判断 Plan A 是否完整，则升级为 error。

### planner_underplanning

当 `document_set_plan_required=true`，但 Plan A 明显少列当前 scope 内可识别的 leaf docs 时报告。

触发信号：

- evidence paths 中有多个同类实体，Plan A 只列一两个。
- existing docs tree 中已有同类 leaf docs，Plan A 没有 `keep/update/deprecate/prune_candidate` 处理。
- route/controller/migration/service/package/config/runbook 等命名信号明确存在，但 leaf_docs 没有 must/should/candidate/defer 记录。
- 多个实体被塞进 index 或 overview，而不是规划 leaf docs。

严重度：

- `standard`：warning；若会导致正文写进 index 或重要实体缺失，则 error。
- `structured` / `partitioned`：error。

建议修复：要求 Planner 重新输出 Plan A，补充 `coverage_basis`、`scope_boundary` 和所有 missing leaf_docs。


### worker_delegate_not_dispatched

当 report 声称 `execution_mode=team_agent` 或 `execution_mode=native_subagent`，但 changed substantive docs 没有对应 Worker delegate dispatch 记录时报告。`worker_subagent_not_dispatched` 是兼容旧报告的别名。

触发信号：

- 多个 substantive target 由 Leader 一次性写入，没有 per-target Worker delegate 结果。
- `worker_dispatch` 缺失或只写“handled by main agent”，但没有 serial fallback reason。
- L/XL 或 `document_set_plan_required=true` 场景中，tasks 有多个 target_path，却没有 Worker delegate 派发摘要。

严重度：warning；若导致多 target 混写、漏验证或覆盖人工内容，升级为 error。

### delegated_discovery_to_worker

当 Planner 明确把“继续发现文档 / 补充子文档 / 拆分实体”的职责交给 Worker 时报告。

典型文本：

- “remaining docs to be discovered by Worker”
- “Worker should decide additional leaf docs”
- “先写这几个，其他后续补”
- “index 先承载，Worker 发现后再拆”

严重度：`error`。Worker 可以报告异常溢出，但 Planner 不能把它设计成常规流程。

## 4. 场景专项检查

### Monorepo / XL

检查：

- 是否识别 workspace / service / package scope。
- 是否有 `docs/code/workspaces.md` 或明确不适用说明。
- `ACTIONDOCK.md` 是否只作为入口，没有堆积 service 细节。
- 局部 workspace 事实是否被错误推广为全仓库事实。
- noise filters 是否记录 generated、build output、lockfile-only auxiliary 等。

### breaking change

检查是否记录：

- 旧行为。
- 新行为。
- 影响对象。
- 迁移边界。
- 兼容窗口或不兼容说明。

可能目标：

- `docs/api/compatibility.md`
- `docs/domain/migrations.md`
- 相关 API/Data/Flow leaf doc 的兼容性章节

### rename / move

检查：

- 是否优先迁移或更新已有文档。
- 是否出现新旧重复文档。
- report 是否记录 old_path → new_path。
- PRUNE 前是否检查链接和人工 TODO。

### stale docs

检查：

- 是否有 evidence 证明 materially stale。
- `edit_mode` 是否记录为 `minimal_patch` 或 `full_rewrite_with_preservation`。
- 整体重写是否保留人工 TODO、备注、历史背景、有效链接。
- report 是否说明为什么不是最小编辑。

### ingest

检查：

- 每个 inbox item 是否被吸收、保留、拒绝或标记 unsafe。
- 成功吸收前是否没有删除 inbox 文件。
- `.kb_inbox/` cleanup 是否只删除显式任务指定的已吸收普通文件。
- 不相关或 unsafe 材料是否保留并说明原因。

## 5. Secret 检查

禁止写入：

- 真实 token。
- password。
- private key。
- 完整连接串。
- session cookie。
- API key 值。

允许写入：

- 变量名。
- 脱敏示例，例如 `<redacted>`。
- 来源路径。
- 用途。
- 如何查找或轮换的说明，但不包含 secret 值。

## 6. finding 输出

```json
{
  "severity": "warning",
  "path": "docs/api/http.md",
  "issue": "index_content_sink: HTTP 入口页包含 orders resource 的完整 schema。",
  "suggested_repair": "拆分到 docs/api/http/orders.md，并在入口页保留链接。"
}
```

严重性枚举：

- `error`：安全、路径、secret、断链、必需 leaf doc 缺失、L/XL 结构性问题。
- `warning`：可维护性风险、XS/S 轻量流程中的拆分建议、不完整 evidence。
- `info`：范围说明、lite 验证未覆盖全仓库、可选改进。

## 7. repair 策略

Validator 本身不修复。若 `repair=true`：

1. 把 findings 转成 Router/Planner 输入。
2. 按规模选择 flow profile。
3. 对结构性修复启用 document_set_plan。
4. 执行 Apply。
5. 再次 Validate。
