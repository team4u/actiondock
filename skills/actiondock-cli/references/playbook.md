# 任务手册（Playbook）

任务手册是 ActionDock 平台内的任务导览资产；CLI/API 统一使用 `playbook`。先遵守 `references/common.md`。

Playbook 负责说明任务入口、风险边界、停止条件、建议知识、候选脚本、可选 Agent Skill、相关任务和下一步。它不是步骤 DSL 或执行引擎；`scriptRefs` 是候选工具池，`relatedPlaybookRefs` 是任务导航。

本文件只负责 Playbook 路由、边界、问题清单和关联资源选择；项目知识检索协议必须实际读取 `project-knowledge.md`。

## 消费快路径

业务项目、流程、接口、数据库、日志、告警和排障类问题默认先走 Playbook。

```bash
actiondock playbook list --enabled --intent "<regex>" --json
actiondock playbook get <playbook-id> --json
```

如果用户已明确项目，或候选过多需要收窄：

```bash
actiondock repository list --purpose project --intent "<regex>" --json
actiondock playbook list --repository-id <repositoryId> --enabled --intent "<regex>" --json
```

`playbook list` 返回摘要，不含 `guideMarkdown`、`knowledgeRefs`、`scriptRefs`、`agentSkillRefs`、`relatedPlaybookRefs`、`stopConditions`；命中候选后必须 `playbook get` 读完整详情。

固定五段式消费：

1. Route：确认当前 Playbook 匹配用户意图。
2. Bound：检查 `repositoryIds`、`riskLevel`、`stopConditions`。
3. Equip：查看 `agentSkillRefs`，判断当前 Agent 是否已有可用 Skill。
4. Investigate：阅读 `guideMarkdown`，结合选中脚本 schema 和 `knowledgeRefs` 生成问题清单；进入项目知识前实际读取 `project-knowledge.md`。
5. Act/Handoff：信息足够且风险可接受时执行选中脚本，或按 `relatedPlaybookRefs` 显式跳转。

命中停止条件时停止，并向用户说明缺少什么或为什么需要人工确认。

总结时默认说明：命中的 Playbook、风险等级、使用或缺失的 Agent Skill、选中的脚本、查过的 schema、实际参考的项目文档、是否跳转过相关 Playbook、仍未补齐的问题。

## Session / Trace 留痕

Playbook Session/Trace 是旁路审计层，记录 Agent 如何消费 Playbook；它不控制流程、不替 Agent 决策、不编排脚本。外部 Agent 可以在五段式消费过程中主动上报关键判断、证据、动作和风险变化。

核心定位：

- Playbook 定义“应该怎么装配任务”。
- Session 记录“一次任务实际怎么被 Agent 使用”。
- Trace 记录“过程中每一步判断、证据、动作和风险变化”。
- `scriptRefs` 仍只是候选动作池，`relatedPlaybookRefs` 仍只是导航；Session 不会把它们变成执行顺序。

### 开始 Session

命中 Playbook 后可以立即创建 Session。创建时服务端会保存 Playbook 当时的风险、项目和停止条件快照，并自动写入 `SESSION_STARTED` 事件。

```bash
actiondock playbook session start <playbook-id> \
  --intent "退款|refund|失败|failure" \
  --user-prompt "rf_123 退款为什么失败" \
  --agent cursor \
  --agent-run-id cursor-run-abc \
  --candidate-playbook-id refund-failure \
  --candidate-playbook-id payment-callback-failure \
  --json
```

文本输出只展示 Session 摘要；需要机器读取时用 `--json`。如果输出很长，按 `common.md` 用 `--output-file`。

### 追加 Trace Event

Trace Event 应贴合五段式消费，不要求每一步都上报。建议至少记录：Playbook 选择、边界读取、停止条件检查、脚本候选选择、脚本执行请求/结果、诊断结论和 Session 结束。

```bash
actiondock playbook session event <session-id> \
  --phase BOUND \
  --type STOP_CONDITION_CHECKED \
  --decision passed \
  --reason "refundId 已提供，当前只读查询" \
  --payload-json '{"checkedConditions":["缺少关键上下文","需要高风险写操作"]}' \
  --external-event-id cursor-run-abc-step-4 \
  --json
```

常用事件示例：

```bash
actiondock playbook session event <session-id> \
  --phase ROUTE \
  --type PLAYBOOK_SELECTED \
  --ref-type playbook \
  --ref-id refund-failure \
  --decision selected \
  --reason "用户问题包含 refundId，且现象是退款失败" \
  --json

actiondock playbook session event <session-id> \
  --phase INVESTIGATE \
  --type SCRIPT_CANDIDATE_SELECTED \
  --ref-type script \
  --ref-id query-refund-log \
  --decision selected \
  --reason "用户提供了 refundId，query-refund-log 是最小只读查询动作" \
  --json

actiondock playbook session event <session-id> \
  --phase ACT \
  --type DIAGNOSIS_EMITTED \
  --message "支付网关退款成功，但业务回调未更新订单状态" \
  --json
```

幂等规则：

- 重试上报时带 `--external-event-id <stable-id>`。
- 服务端按 `sessionId + externalEventId` 去重。
- `sequence` 由服务端分配，不要自行推断。

脱敏规则：

- Trace 可能包含订单号、用户 ID、环境名、日志片段、错误栈或密钥片段。
- 不要把大段日志、完整响应或密钥写入 `payload`。
- 平台会基础脱敏 `token`、`secret`、`password`、`authorization`、`cookie`、`apiKey`、`accessKey` 等字段，但 Agent 仍应只上报引用和摘要。

推荐写引用而不是全文：

```json
{
  "summary": "发现 payment_callback_timeout",
  "evidenceRefs": [
    {"type": "execution", "id": "exec_01JXYZ"}
  ]
}
```

### 查看时间线

```bash
actiondock playbook session show <session-id> --timeline
actiondock playbook session show <session-id> --json
```

`--timeline` 适合给人看，输出类似：

```text
[ROUTE] PLAYBOOK_SELECTED selected playbook:refund-failure - 用户问题匹配退款失败场景
[BOUND] STOP_CONDITION_CHECKED passed - 当前只做只读查询
[INVESTIGATE] SCRIPT_CANDIDATE_SELECTED selected script:query-refund-log
[ACT] DIAGNOSIS_EMITTED - 支付回调未更新订单状态
```

### 关闭 Session

任务结束、停止、失败、取消或跳转时显式关闭 Session。

```bash
actiondock playbook session complete <session-id> \
  --status COMPLETED \
  --final-summary "确认支付网关退款成功，业务回调未更新订单状态。" \
  --json
```

支持的终态：

- `COMPLETED`：已有结论或任务完成。
- `STOPPED`：命中停止条件或需要人工确认。
- `FAILED`：任务执行失败。
- `CANCELLED`：用户取消。
- `HANDED_OFF`：已流转到另一个 Playbook。

关闭后不要继续上报事件；如果跳转到相关 Playbook，创建新的 Session，并重新执行五段式消费。不要继承上一个 Playbook 的脚本、知识引用或停止条件。

## 结果收束

只有证据已经指向后续动作、相关任务、阻断原因或风险边界时，才展示“推荐下一步”。依据优先级：

1. 用户问题、`guideMarkdown`、已读取项目知识、脚本 schema 和执行/查询结果。
2. `stopConditions`、`riskLevel`、用户授权状态。
3. `relatedPlaybookRefs`，只作可选导航，不自动递归。
4. `scriptRefs`，只作候选动作池。

输出规则：

- 没有明确下一步时，只说明当前结论和缺口。
- 高风险动作进入“需要人工确认”或“当前不建议”。
- 不基于自然语言猜测直接推荐写操作、补偿、退款、回滚、人工改库或批量执行。
- 推荐切换 Playbook 时说明证据；切换后重新执行五段式。
- 建议执行脚本前，必须已查询 schema、参数来源完整、风险可接受且未命中停止条件。

## 通用项目调查 fallback

没有命中可用 Playbook，或当前 Playbook 无法覆盖任务时，用通用 guide：

```text
根据用户当前问题定位项目知识、脚本参数和下一步动作。先判断是否需要脚本；需要脚本时，只从脚本摘要中选择与用户问题最相关的脚本。默认 1 个，最多 3 个。先看选中脚本 schema，再用 schema 字段、字段描述、枚举值和用户问题生成知识检索问题清单。进入任何项目知识、知识库、文档或源码搜索前，必须先实际读取 references/project-knowledge.md；只围绕问题清单读取项目知识、文档或源码。
```

最小路线：

1. 确认目标项目仓库 ID。
2. 判断是否需要脚本；需要时只选相关脚本，不批量查 schema。
3. 只对选中脚本查询 schema。
4. 用用户问题、guide 和 schema 生成问题清单。
5. 实际读取 `project-knowledge.md`，按协议读取项目知识。
6. 信息足够且风险可接受时，才执行脚本。

停止条件：缺少目标项目、入口为空、需要高风险写操作、需要生产数据权限但未确认、无法判断是否应使用专用 Playbook。

## 关联资源

### Agent Skill

`agentSkillRefs` 是给当前执行 Agent 的软提示，不是 ActionDock Skill 资产。ActionDock 不安装、不发布、不检查这些 Skill 是否存在。

- 当前环境已有对应 Skill 时，按 `purpose` 判断是否使用。
- 缺少 Skill 时不要尝试通过 ActionDock 安装；继续走 `guideMarkdown`、`knowledgeRefs`、`scriptRefs`。
- `required: true` 只表示任务作者认为重要，消费端仍按当前环境判断。

### 相关 Playbook

`relatedPlaybookRefs` 只做任务导航：

- `RELATED`：同问题域相关任务，用户问题需要时才跳转。
- `FOLLOW_UP`：当前任务定位到某类结果后的后续任务。
- `FALLBACK`：当前专用 Playbook 不匹配或无法覆盖时的退路。

跳转前说明原因；跳转时 `playbook get <related-id>` 并重新读取风险、停止条件、guide 和资源引用。禁止自动继承、合并或递归加载上一个 Playbook 的资源。

### 脚本选择与 schema

`scriptRefs` 是候选脚本池：

- 优先匹配用户问题、`guideMarkdown`、业务对象、故障类型和 `purpose`。
- 默认只选 1 个最相关脚本；确有并行路径时最多 3 个。
- 不相关脚本不查 schema；无法判断时先查项目知识或问用户。

```bash
actiondock script schema <script-id> --json
```

看 schema 的目的不一定是执行脚本，而是反推出知识库需要回答的问题。临时问题清单应覆盖任务目标、选中脚本、字段名/描述/required/enum/默认值、参数来源、搜索关键词。

### 知识引用

`knowledgeRefs` 只做引用，不内联知识正文：

- `NOTE`：针对项目仓库的附加阅读指引。
- `FILE`：项目仓库内相对路径。

按问题清单定向使用，不要因为存在 `knowledgeRefs` 就全量阅读。进入项目知识时把问题清单、相关 `NOTE` / `FILE` 和目标仓库范围交给 `project-knowledge.md`。

### 执行脚本

只有问题清单已补齐、风险可接受、没有命中停止条件时，才按 `script-execution.md` 执行选中脚本。高风险写操作、缺少关键上下文、Playbook 要求人工确认时不要自动运行。

## 作者态维护

```bash
actiondock playbook create --definition-file ./playbook.json --json
actiondock playbook update <playbook-id> --definition-file ./playbook.json --json
actiondock playbook delete <playbook-id> --json
```

复杂字段只走 `--definition-file`，不要把 `guideMarkdown`、知识引用、脚本引用拆成大量 CLI flags。

最小定义：

```json
{
  "id": "refund-failure",
  "name": "退款失败排查",
  "description": "定位退款失败根因并给出下一步建议",
  "tags": ["refund", "payment"],
  "riskLevel": "MEDIUM",
  "repositoryIds": ["billing-service"],
  "knowledgeRefs": [
    {"type": "NOTE", "repositoryId": "billing-service", "markdown": "先看退款链路背景。"},
    {"type": "FILE", "repositoryId": "billing-service", "path": "docs/runbooks/refund-runbook.md"}
  ],
  "scriptRefs": [
    {"scriptId": "query-log", "purpose": "查询退款链路日志"}
  ],
  "agentSkillRefs": [
    {"skillId": "openai-docs", "purpose": "需要查官方文档时使用", "required": false}
  ],
  "relatedPlaybookRefs": [
    {"playbookId": "generic-project-investigation", "relation": "FALLBACK", "purpose": "专用手册不适用时退回通用项目调查"}
  ],
  "guideMarkdown": "先读取 ACTIONDOCK.md，再查看 refund-runbook.md。",
  "stopConditions": ["缺少关键上下文", "需要高风险写操作", "已确认根因"],
  "enabled": true
}
```

平台校验：

- `guideMarkdown` 非空。
- `scriptRefs.scriptId` 存在。
- `agentSkillRefs.skillId` 非空；不校验 Skill 是否存在。
- `relatedPlaybookRefs.playbookId` 非空，且不能引用当前任务手册。
- `relatedPlaybookRefs.relation` 只能是 `RELATED` / `FOLLOW_UP` / `FALLBACK`。
- `NOTE.markdown` 非空。
- `FILE.path` 必须是仓库内相对路径。
