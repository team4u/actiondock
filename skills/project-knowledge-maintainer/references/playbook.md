# Playbook：统一流水线

该 skill 只暴露一个稳定流程：

```text
Route → Plan → Apply → Validate
```

不要把复杂度暴露为一套组织架构。Router、Planner、Worker、Validator 是角色边界；subagent 只是可选执行模式。

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

常见调用：

```yaml
repoPath: .
operation: validate
repair: false
```

```yaml
repoPath: .
operation: refresh
changedFiles:
  - src/users/user.service.ts
  - db/migrations/20260522_add_user_status.sql
```

```yaml
repoPath: .
operation: ingest
inboxPaths:
  - .kb_inbox/payment-timeout-runbook.md
```

## 1. Route

Router 决定：

- operation：`init`、`refresh`、`ingest`、`validate`
- 激活哪些 documentation domain
- phase 顺序
- ingest 时每个 inbox item 的分类
- 哪些 domain 被跳过，以及原因

Router 不写文件，不阅读大量实现细节，不创建 Worker 正文任务。

### 场景分类

Router 在选择 domain 前必须读取 `references/scenario-matrix.md`，输出：

- `scale`: `XS` / `S` / `M` / `L` / `XL`
- `change_types`: 一个或多个真实变更类型
- `workspace_scope`: monorepo 或多服务场景中的受影响 workspace/service/package
- `special_flags`: rename、breaking、stale、noise-heavy、lockfile-only 等风险标记
- `noise_filters`: 被降噪的 changed files 及原因

默认策略：

| Scale | 策略 |
|---|---|
| `XS` / `S` | 最小编辑，尽量只改一个目标文档 |
| `M` | 多 domain 更新，合并同 target 任务 |
| `L` | 分 phase，先底层事实，再业务/接口，最后架构/入口 |
| `XL` | 先识别 workspace/service/package，过滤噪音，分批维护 |

如果 changedFiles 数量很大，Router 必须先识别并记录 generated、build output、format-only、lockfile-only 等噪音；不得让这些噪音直接触发业务事实文档。

### 大仓库规则

出现 `apps/`、`packages/`、`services/`、`libs/`、`infra/`、`terraform/`、`charts/` 等结构时：

1. 先建立或更新 `docs/code/workspaces.md` 或等价索引。
2. 只刷新受影响 workspace / service / package 的正式 docs。
3. 共享包变化要判断是否影响多个 downstream service；证据不足时写入 evidence gaps。
4. `ACTIONDOCK.md` 只链接入口，不展开所有 service 细节。

### operation 选择

| 优先级 | 情况 | operation |
|---:|---|---|
| 1 | 用户明确要求检查、验证知识库状态，或指定 `operation=validate` | `validate` |
| 2 | 用户明确要求处理 `.kb_inbox/`、指定 inboxPaths，或指定 `operation=ingest` | `ingest` |
| 3 | 用户明确要求初始化，或指定 `operation=init` | `init` |
| 4 | 未明确指定操作，且 `ACTIONDOCK.md` 或 `docs/` 缺失 | `init` |
| 5 | 未明确指定操作，且已有正式知识库 | `refresh` |

若 `operation=auto`：先按用户明确意图选择，再按仓库状态选择；不要因为 `.kb_inbox/` 存在就自动 ingest，除非用户明确要求处理它。

### refresh baseline

若用户提供 `changedFiles`，以用户提供为准。否则优先使用 Git：

1. `git status --porcelain`
2. `git diff --name-only HEAD`
3. 如存在 staged change，也检查 `git diff --cached --name-only`

若 Git 不可用，改为扫描仓库结构和文件修改线索，并在报告中记录 baseline 不完整。

## 2. Plan

每个激活 domain 运行一个 Planner。Planner 只读证据，产出 target_path 级任务。

Planner 输出：

```json
{
  "tasks": [],
  "skipped": []
}
```

任务必须是：

- `UPSERT`：创建或更新一个具体 Markdown 文件。
- `PRUNE`：删除一个确认 stale 的普通文件，或删除一个已成功吸收的 `.kb_inbox/` 文件。

禁止 Planner：

- 写文件
- 直接起草最终正文
- 发明没有证据的任务
- 输出绝对路径、`..`、通配符或 repo 外路径
- 输出 wildcard target，例如 `docs/data/tables/*.md`

### PRUNE 规则

`PRUNE target_path` 必须满足二选一：

1. 正式输出路径：`ACTIONDOCK.md`、report 或 `docs/` 下普通文件；或
2. `operation=ingest`，且目标位于 `.kb_inbox/`，并且该 inbox item 已成功吸收进正式文档。

不得删除目录。不得为了“整理”而清空 `.kb_inbox/`。未吸收、unsafe、unrelated、preserve_for_human 的 inbox item 必须保留，并在报告中说明。

## 3. Apply

每个唯一 `target_path` 只允许一个 Worker 拥有。

Worker 负责 exactly one target：

- `UPSERT`：读取现有 target、证据文件和必要的前序 phase 文档；产出长期可维护文档。
- `PRUNE`：只删除指定普通文件，不删除目录。

多个 Planner 指向同一个 `target_path` 时，Leader 合并任务，不丢弃任何 evidence、clue、dependency 或低 confidence 警告。

### 最小编辑原则

默认做最小必要编辑：

- 保留人工段落、备注、TODO、历史上下文、外部链接和有用结构。
- 只修改与证据变更相关的章节。
- 不为了统一风格而重写整篇文档。
- 只有在证据表明整篇文档 materially stale、结构阻碍维护，或用户明确要求重写时，才允许整体重构。
- 整体重构时必须在 report 中说明原因和主要保留/删除内容。

### 特殊场景 Apply 规则

- `rename_move`：优先迁移或更新已有相关文档，不创建重复新旧事实页；report 记录 old_path → new_path。
- `breaking_change`：相关文档必须说明旧行为、新行为、影响对象和迁移边界；必要时维护 `docs/api/compatibility.md` 或 `docs/domain/migrations.md`。
- `stale_doc_refresh`：只有 materially stale 时允许 `full_rewrite_with_preservation`，并保留人工 TODO、备注、历史背景、有效链接。
- `delete_deprecate`：删除代码不等于立刻删文档；仍在线上或仍有迁移价值时改为 deprecated 说明。
- `XL`：只写当前 workspace_scope 相关事实，不把局部事实推广为全仓库事实。

### 原子写入

`UPSERT` 必须：

1. 在同目录写临时文件。
2. 验证路径、内容和基本链接。
3. 原子 rename 覆盖目标文件。

证据不足、路径不安全或写入失败时，不要覆盖旧文件。

## 4. Validate

Validator 只读检查：

- `ACTIONDOCK.md` 是否存在。
- `ACTIONDOCK.md` 的“已建立”链接是否指向存在文件。
- `ACTIONDOCK.md` 的“待建立 / 暂无证据”项是否避免使用 Markdown 链接。
- docs 链接是否指向存在文件。
- substantive docs 是否包含 `证据与边界` 或 `Evidence and Boundaries`。
- navigation/index docs 是否链接到正文档，或明确说明暂无证据 / 不适用。
- docs 是否引用临时路径作为最终证据。
- changed files 是否有合理 domain 覆盖。
- inbox 文件是否被吸收、保留或拒绝，并有原因。
- 是否暴露明显 secret、token、private key 或完整敏感连接串。
- 是否错误要求 `.knowledge_base/` 布局。
- 大仓库是否有 workspace/service 索引或明确不适用。
- breaking change 是否有兼容性说明。
- rename/move 后是否产生重复文档。
- stale docs 是否记录 edit_mode 和保留人工内容。
- XL 场景是否报告 changedFiles 降噪结果。

`validate` 模式默认不改正文档。只有用户明确要求修复，或输入 `repair=true`，才可从 Validator findings 进入 Plan/Apply repair 流程。

## Operation 矩阵

| Operation | Route | Plan | Apply | Validate |
|---|---|---|---|---|
| `init` | 使用默认 phase，并根据证据跳过无关 domain | 为激活 domain 生成初始 docs 任务 | 创建 `ACTIONDOCK.md`、正式 docs 和 init report | 检查入口、链接、证据与边界 |
| `refresh` | 根据 changed files 和 docs tree 路由 | 生成 UPSERT/PRUNE 任务 | 分 phase 更新或修剪 docs | 检查变更是否反映到正式 docs |
| `ingest` | 分类 inbox，再路由到 domain | 将 inbox 材料转成正式文档任务或保留理由 | 吸收材料；成功后才清理已处理 inbox 文件 | 检查每个 inbox item 的处理结果 |
| `validate` | 决定验证范围 | 默认不生成写任务 | 默认不写 | 生成 validate report |

## 执行模式

### native_subagent

运行时支持时可以使用：

- Router：每次运行最多一个。
- Planner：每个 phase 的每个激活 domain 一个。
- Worker：每个唯一 `target_path` 一个。
- Validator：大范围验证时可以多个只读 validator。

同一 phase 的 Planner 可并行。同一 phase 的 Worker 只有在 `target_path` 不同时才可并行。phase N+1 必须等待 phase N 的 Worker 完成或失败。

### serial

当 subagent 不可用时，serial 是一等执行模式，不是降级破坏。

主 agent 必须按角色边界依次执行：

```text
Router role → Planner role(s) → Worker role per target_path → Validator role
```

serial 模式下，主 agent 可以“以 Worker role”写一个具体 `target_path`，但必须：

- 一次只处理一个 target。
- 使用同一 Worker contract。
- 不在 Planner 阶段提前写正文。
- 在报告中记录 `execution_mode=serial` 和 fallback reason。

## Richness Floor

不要把长期知识库写成短摘要。

每个 substantive docs 应尽量包含：

- 目的与范围
- 当前行为
- 关键文件
- 关键流程或生命周期
- 接口、契约或 schema
- 数据与状态
- 运维说明
- 证据与边界
- 维护备注

不是每篇都需要所有章节，但 Worker 必须写出能让后续维护者接手项目的 durable project knowledge。证据不足时，写已确认事实，并在 `证据与边界` 中列出缺口。

navigation/index docs 可以更短，但必须做到：

- 不制造断链。
- 不把待建立项目伪装成已完成事实。
- 链接到有证据区的正文档，或明确标记暂无证据 / 不适用。

## Coverage Floor

七个 documentation domain 都必须被考虑：

1. Architecture
2. API
3. Data
4. Business Flow
5. Agent / Tool
6. Infra / Env
7. Maintenance / Ops

跳过 domain 必须记录原因：

- `no_relevant_evidence`
- `unchanged_from_current_docs`
- `outside_requested_scope`
- `blocked_by_missing_files`
- `unsafe_path`
- `insufficient_confidence`

## 证据规则

证据优先级：

1. 当前仓库源码、配置、DDL、迁移、脚本、测试。
2. 现有正式 docs。
3. `.kb_inbox/` 人工材料。
4. 日志、注释和生成文本。

证据冲突时，以当前仓库文件为准，并在文档或报告中说明冲突。

使用 `references/evidence-search.md` 选择技术栈相关证据路径；它只指导读取，不扩大写入范围。

## 敏感信息规则

不要写入：

- 真实 token、API key、password、private key
- 完整数据库连接串
- 私有证书内容
- 可用于直接访问生产系统的敏感凭据

可以写入：

- 环境变量名
- 配置文件路径
- 脱敏示例
- 用途说明
- 本地开发所需的非敏感步骤

## 路径安全

写入或删除前必须检查：

- 拒绝绝对路径。
- 拒绝包含 `..` 的路径。
- 拒绝通配符。
- `forbiddenSegments` 按路径段匹配。
- 目标必须在 repoPath 内。
- 新文件先 resolve 父目录真实路径。
- symlink 不能逃逸 repoPath。
- 正式输出只能在 `ACTIONDOCK.md`、报告文件或 `docs/` 下。
- inbox cleanup 只能处理已成功吸收、且显式列为 cleanup task 的 `.kb_inbox/` 普通文件。
- 不删除目录。

## 失败策略

Worker command 或文件操作失败时：

1. 记录 command、exit code、stdout 摘要和 stderr。
2. 将错误文本反馈给同一 Worker，让它重新发现证据或选择安全失败。
3. 每个任务最多重试 `contract.json` 中的 `worker.maxRetries` 次。
4. 仍失败时，不覆盖旧文件，不写 partial doc。
5. 标记任务 `FAILED`。
6. mutating operation 下写入或追加 `docs/ops/maintenance/errors.md`。
7. 在 operation report 中记录失败和人工处理建议。

## 报告要求

每次运行结束写对应 report，并在最终响应中简述。报告至少包含：

- operation
- execution_mode
- serial_fallback_reason
- repo_baseline
- changed_files
- activated_domains
- skipped_domains
- tasks_completed
- tasks_failed
- files_changed
- validation_status
- evidence_gaps
