# Playbook：自适应流水线

该 skill 不再把所有任务都压进同一个重流程。安全、证据和路径边界始终固定；规划深度按规模和风险触发。

```text
XS/S:   Route-lite → Apply → Validate-lite
M:      Route → Task Plan → Apply → Validate
        若存在 leaf doc / index / 多实体拆分风险，插入 Document Set Plan
L/XL:   Route → Document Set Plan → Task Plan → Phased Apply → Validate
validate-only: Route-lite → Validate
```

Router、Planner、Worker、Validator 是角色边界。team agent / multi-agent team 可用时优先使用；否则使用 native subagent。Worker 必须作为写入隔离的执行代理使用；serial 只是 fallback，不是首选执行方式。serial 模式下，主 agent 可以按角色顺序执行，但不得混淆“规划”和“写入”的责任。

## 0. 输入约定

推荐输入是结构化键值：

```yaml
repoPath: .
operation: auto
changedFiles: []
inboxPaths: []
repair: false
```

只有 `repoPath` 必填。`operation` 缺省为 `auto`，`repair` 缺省为 `false`。

可选控制项：

```yaml
forceDocumentSetPlan: false
maxPlanningDepth: auto   # auto | lite | standard | structured | partitioned
```

## 1. Route / Route-lite

Router 决定：

- resolved operation：`init`、`refresh`、`ingest`、`validate`
- scale：`XS`、`S`、`M`、`L`、`XL`
- flow profile：`lite`、`standard`、`structured`、`partitioned`、`validate_only`
- 激活哪些 documentation domain
- 是否需要 `document_set_plan`
- 是否需要 phase、workspace scope、noise filter 或专项验证

Router 不写文件，不起草正文，不创建最终文档内容。

### operation 选择

| 优先级 | 情况 | operation |
|---:|---|---|
| 1 | 用户明确要求检查、验证知识库状态，或指定 `operation=validate` | `validate` |
| 2 | 用户明确要求处理 `.kb_inbox/`、指定 inboxPaths，或指定 `operation=ingest` | `ingest` |
| 3 | 用户明确要求初始化，或指定 `operation=init` | `init` |
| 4 | 未明确指定操作，且 `ACTIONDOCK.md` 或 `docs/` 缺失 | `init` |
| 5 | 未明确指定操作，且已有正式知识库 | `refresh` |

若 `operation=auto`：先按用户明确意图选择，再按仓库状态选择；不要因为 `.kb_inbox/` 存在就自动 ingest。

### refresh baseline

若用户提供 `changedFiles`，以用户提供为准。否则优先使用 Git：

1. `git status --porcelain`
2. `git diff --name-only HEAD`
3. 如存在 staged change，也检查 `git diff --cached --name-only`

若 Git 不可用，改为扫描仓库结构和文件修改线索，并在报告中记录 baseline 不完整。

### scale 判定

| Scale | 常见信号 | 默认流程 |
|---|---|---|
| `XS` | 单个 env、脚本命令、文档链接、小配置名更新 | `lite` |
| `S` | 少量相关文件，一个已知 leaf doc 可覆盖 | `lite` |
| `M` | 多 domain、新 endpoint、新表、新 flow、小型功能 | `standard` |
| `L` | breaking、迁移、大功能、多模块重构 | `structured` |
| `XL` | monorepo、多 service、大量 changedFiles、噪音重 | `partitioned` |

不要仅凭 changedFiles 数量判断规模。要先过滤 generated、format-only、build output、dependency output、lockfile-only auxiliary 和 vendor noise。

### domain 输出策略

七个 domain 必须隐式考虑：Architecture、API、Data、Business Flow、Agent/Tool、Infra/Env、Maintenance/Ops。

输出规则：

- XS/S：只输出 activated domains；跳过的 domain 不必逐个列出。
- M：输出 activated domains；对有风险、被用户点名或被证据阻塞的 skipped domain 说明原因。
- L/XL：输出 activated domains、material skipped domains、phase 和降噪结果。

## 2. Document Set Plan：按需启用

`document_set_plan` 是“分类下应该有哪些 leaf docs”的清单规划，不是单篇文档的大纲。

必须启用的情况：

- scale 为 `L` 或 `XL`。
- scale 为 `M` 且涉及新增业务流程、API resource、数据表、跨表事务、配置域、runbook、诊断路径、service 或 package。
- 目标可能是入口页，但证据需要正文档承载。
- `operation=init` 且仓库不是明显 XS/S。
- `operation=ingest` 且多个 inbox item 需要分流或拆成 runbook / diagnosis / config 文档。
- Validator 发现 `index_content_sink`、`category_under_split`、`missing_required_leaf_doc` 或 `document_set_plan_missing_when_required`。
- 用户指定 `forceDocumentSetPlan=true`。

### Plan A 完整性

当 `document_set_plan_required=true` 时，Planner 的 Plan A 必须先回答“当前 scope 下应该有哪些 leaf docs”，再回答“本轮写哪些 target_path”。

Plan A 必须：

- 读取或检查 relevant existing docs tree，避免重复建文档或漏掉已有文档。
- 根据 routes/controllers/events/migrations/services/packages/config/runbook/inbox 等证据信号枚举预期 leaf docs。
- 把 leaf docs 分为 `must`、`should`、`candidate`，用 `create/update/keep/defer/deprecate/prune_candidate` 表示状态。
- 对证据不足项使用 `defer` 或 `candidate`，不要直接省略。
- 在每个 category 上写 `coverage_basis`、`coverage_assertion`、`scope_boundary` 和 `excluded_candidates`。

Plan A 禁止：

- 只列 1-2 个目标文件后让 Worker 自行补充。
- 用“先写 index / overview，后续再拆”替代 leaf doc 规划。
- 把明显应独立的 flow、API resource、table、config、runbook、diagnosis、service 或 package 合并到一个正文档。

可以省略的情况：

- XS/S 只更新一个已存在 leaf doc。
- 只修复导航链接、标题、状态标记或 `ACTIONDOCK.md` 入口。
- validate-only 且 `repair=false`。
- 明确无新实体、无 index 风险、无多文档拆分需求。

## 3. Task Plan

Planner 只读证据，输出 target_path 级任务。

允许 action：

- `UPSERT`：创建或更新一个具体 Markdown 文件。
- `PRUNE`：删除一个确认 stale 的普通文件，或删除一个已成功吸收的 `.kb_inbox/` 文件。

禁止 Planner：

- 写文件。
- 直接起草最终正文。
- 发明没有证据的任务。
- 输出绝对路径、`..`、通配符或 repo 外路径。
- 输出 wildcard target，例如 `docs/data/tables/*.md`。

### task 规则

每个 task 对应一个最终 `target_path`。多个 Planner 指向同一个 `target_path` 时，Leader 合并任务，不丢弃 evidence、clue、dependency 或低 confidence 警告。

`PRUNE target_path` 必须满足二选一：

1. 正式输出路径：`ACTIONDOCK.md`、report 或 `docs/` 下普通文件；或
2. `operation=ingest`，且目标位于 `.kb_inbox/`，并且该 inbox item 已成功吸收进正式文档。

不得删除目录。不得为了“整理”而清空 `.kb_inbox/`。未吸收、unsafe、unrelated、preserve_for_human 的 inbox item 必须保留，并在报告中说明。

## 4. Apply

每个唯一 `target_path` 只允许一个 Worker 拥有。Worker 可以读取相关证据和相关文档，但只能写自己的 target。

Worker 负责：

- `UPSERT`：读取现有 target、证据文件和必要前序文档；产出长期可维护文档。
- `PRUNE`：只删除指定普通文件，不删除目录。

### 最小编辑原则

默认做最小必要编辑：

- 保留人工段落、备注、TODO、历史上下文、外部链接和有用结构。
- 只修改与证据变更相关的章节。
- 不为了统一风格而重写整篇文档。
- 只有在证据表明整篇文档 materially stale、结构阻碍维护，或用户明确要求重写时，才允许整体重构。
- 整体重构时必须在 report 中说明原因和主要保留/删除内容。

### Worker 自主性

Worker 不需要等 Planner 指定每一个读取文件；可以为了完成 target 读取相关代码、测试、配置、现有 docs 和前序 phase 输出。

但 Worker 不得：

- 写非自己拥有的 target_path。
- 创建 repo 外文件。
- 把正文事实写入 index/navigation doc。
- 泄露 secret。
- 在 document_set_plan 生效时直接创建规划外 leaf doc。

如果 Worker 发现需要额外 leaf doc：

```json
{
  "status": "NEEDS_REPLAN",
  "target_path": "docs/domain/flows/index.md",
  "proposed_extra_tasks": [
    {
      "action": "UPSERT",
      "target_path": "docs/domain/flows/checkout.md",
      "reason": "index 任务证据实际包含 checkout 主流程正文。"
    }
  ]
}
```

serial 模式下，主 agent 可回到 mini-plan 补一轮；native_subagent 模式下，Leader 合并 proposed task 后再派发 Worker。但这只是异常溢出机制。如果 proposed task 在 Plan A 阶段应当可识别，Validator 应报告 `planner_underplanning`，而不是把它视为正常 Worker 自主发挥。

### Index 与 leaf doc 写入规则

- `index.md`、入口型 `http.md`、入口型 `events.md`、`workspaces.md` 只能写导航、链接、简短状态和范围说明。
- 不得在 index 里写完整流程、完整 API schema、表字段目录、runbook 步骤、诊断步骤或多个实体的长正文。
- 如果 index 任务需要正文内容，Worker 应返回 `NEEDS_REPLAN` 或 warning，要求新增 leaf doc 任务。
- Leaf substantive doc 必须包含 `证据与边界`。

### 原子写入

`UPSERT` 必须：

1. 在同目录写临时文件。
2. 验证路径、内容和基本链接。
3. 原子 rename 覆盖目标文件。

证据不足、路径不安全或写入失败时，不要覆盖旧文件。

## 5. Validate / Validate-lite

Validator 只读检查。`validate` 模式默认不改正文档。只有用户明确要求修复，或输入 `repair=true`，才可从 Validator findings 进入 Plan/Apply repair 流程。

### validate-lite

XS/S 默认使用 validate-lite，检查：

- 变更目标文件是否存在。
- 新增或修改链接是否有效。
- substantive doc 是否有 `证据与边界`。
- navigation/index 是否没有承载长正文。
- 是否暴露明显 secret、token、private key 或完整敏感连接串。
- target path 是否安全。

### full validate

M/L/XL、repair=true 或 validate-only 大范围检查时使用 full validate，额外检查：

- `ACTIONDOCK.md` 是否存在。
- `ACTIONDOCK.md` 的“已建立”链接是否指向存在文件。
- `ACTIONDOCK.md` 的“待建立 / 暂无证据”项是否避免使用 Markdown 链接。
- docs 链接是否指向存在文件。
- navigation/index docs 是否链接到正文档，或明确说明暂无证据 / 不适用。
- 是否出现 `index_content_sink` 或 `category_under_split`。
- `document_set_plan_required=true` 时是否存在 document_set_plan。
- `priority=must` 的 leaf docs 是否存在对应任务、结果文件或明确 defer。
- index 是否链接本轮创建/更新的 must leaf docs。
- Worker 提出的 `proposed_extra_tasks` 是否被执行、defer 或记录为 evidence gap。
- Plan A 是否明显漏掉 current scope 内可识别的 leaf docs。
- Planner 是否把发现职责推给 Worker；若是，报告 `delegated_discovery_to_worker`。
- docs 是否引用临时路径作为最终证据。
- changed files 是否有合理 domain 覆盖。
- inbox 文件是否被吸收、保留或拒绝，并有原因。
- 是否错误要求 `.knowledge_base/` 布局。
- 大仓库是否有 workspace/service 索引或明确不适用。
- breaking change 是否有兼容性说明。
- rename/move 后是否产生重复文档。
- stale docs 是否记录 edit_mode 和保留人工内容。
- XL 场景是否报告 changedFiles 降噪结果。

## 6. Operation 矩阵

| Operation | Route | Plan | Apply | Validate |
|---|---|---|---|---|
| `init` | 缺失入口时初始化；按仓库规模决定 lite/standard/structured | 小仓库可直接建入口；非平凡仓库使用 document_set_plan | 创建 `ACTIONDOCK.md`、正式 docs 和 init report | 检查入口、链接、证据与边界 |
| `refresh` | 根据 changed files 和 docs tree 路由 | XS/S 轻量；M+ 按风险规划 | 分 target 更新 docs | 检查变更是否反映到正式 docs |
| `ingest` | 分类 inbox，再路由到 domain | 单条材料可轻量；多条或多类型材料需 document_set_plan | 吸收材料；成功后才清理已处理 inbox 文件 | 检查每个 inbox item 的处理结果 |
| `validate` | 决定验证范围 | 默认不生成写任务 | 默认不写 | 生成 validate report |

## 7. 执行模式

执行模式按优先级选择：`team_agent` > `native_subagent` > `serial`。team agent 和 subagent 都属于可接受的 delegated execution；差别只在宿主运行时提供的编排能力。

### team_agent

运行时支持 team agent / multi-agent team 且用户未禁止时，应优先使用该模式。它适合把 Router、Planner、Worker、Validator 分配给不同 team member 或 team task，减少单一上下文偷懒、串写和角色污染。

派发规则：

- Router：每次运行最多一个 routing delegate。
- Planner：仅当 flow profile 需要 planning 时，每个 phase 的每个激活 domain 一个 planning delegate。
- Worker：每个唯一 `target_path` 一个独立 Worker delegate；delegate 可以是 team member、team task 或等价隔离执行单元。
- Validator：大范围验证时可以多个只读 validator delegate。

### native_subagent

没有 team agent 但支持 native subagent 且用户未禁止时，应使用该模式。它不是“可有可无的风格选择”；它是隔离 Worker 写入、提升并行度和降低上下文污染的首选 fallback。

派发规则：

- Router：每次运行最多一个。
- Planner：仅当 flow profile 需要 planning 时，每个 phase 的每个激活 domain 一个。
- Worker：每个唯一 `target_path` 一个独立 Worker subagent；这是没有 team agent 时写入正文档的默认方式。
- Validator：大范围验证时可以多个只读 validator。

同一 phase 的 Planner 可并行。同一 phase 的 Worker 只有在 `target_path` 不同时才可并行。phase N+1 必须等待 phase N 的 Worker 完成或失败。

Leader 在 `team_agent` 或 `native_subagent` 模式下不得批量写多个 substantive docs；它只负责编排、任务去重、phase 阻塞、汇总 report，以及允许的入口/报告文件。如果 Leader 发现无法派发 Worker delegate，应切换到 serial 并记录 fallback reason。

### serial

当没有 team agent / subagent、宿主策略阻止、工具不可用或用户禁止代理派发时，主 agent 按同一边界串行执行。serial 是 fallback；不要在 team_agent 或 native_subagent 可用时把它作为偷懒路径。

serial 要求：

- 仍按 Router / Planner / Worker / Validator 的职责切分。
- 记录 `execution_mode=serial` 和 fallback reason。
- Worker 写入时仍保持 one target_path ownership；主 agent 每次只能模拟一个 Worker target。
- 发现 `proposed_extra_tasks` 时可以回到 mini-plan，但必须在 report 记录；如果该任务本应由 Plan A 识别，同时记录 `planner_underplanning`。

## 8. 报告

完成响应和 report 应包含基础字段：

- operation
- execution_mode
- flow_profile
- scale
- repo_baseline
- files_changed
- validation_status
- worker_dispatch：team agent / native subagent 派发摘要，或 serial fallback reason
- evidence_gaps

按需包含：

- changed_files
- activated_domains
- skipped_domains
- tasks_completed / tasks_failed
- change_types
- workspace_scope
- special_flags
- noise_filters
- edit_modes
- scenario_findings
- document_set_plan_summary
- must_leaf_docs / deferred_leaf_docs
- proposed_extra_tasks

XS/S 不需要为了填表而输出空的全量字段。
