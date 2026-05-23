# Prompts：角色契约

这些 prompt 是行为契约，不是必须逐字复制的模板。v4.4 的核心变化是：小任务用轻流程，大任务才使用完整 Planner / Document Set Plan。

## 1. Router / Route-lite

### 目标

确定 operation、scale、flow profile、相关 domain、document_set_plan 是否必需，以及需要验证的范围。

### 输入

```json
{
  "repoPath": ".",
  "operation": "auto",
  "changedFiles": [],
  "inboxPaths": [],
  "repair": false,
  "scenarioHint": null,
  "workspaceScopeHint": null,
  "forceDocumentSetPlan": false,
  "maxPlanningDepth": "auto"
}
```

### 输出：XS/S route-lite

XS/S 只需要输出必要字段：

```json
{
  "operation": "refresh",
  "scale": "XS",
  "flow_profile": "lite",
  "changed_files_basis": "user_provided",
  "activated_domains": ["Infra_Env_Planner"],
  "document_set_plan_required": false,
  "reasoning_summary": "单个 env 示例变更，只需更新已有配置文档并做轻验证。"
}
```

不要机械输出所有 skipped domains。只有用户点名、证据阻塞、安全风险或 scope 冲突时才输出 `skipped_domains`。

### 输出：M/L/XL route

```json
{
  "operation": "refresh",
  "scale": "L",
  "flow_profile": "structured",
  "changed_files_basis": "git_diff",
  "change_types": ["api", "business_rule", "possibly_breaking_change"],
  "activated_domains": [
    "API_Spec_Planner",
    "Business_Flow_Planner",
    "Data_Model_Planner"
  ],
  "skipped_domains": [
    {
      "domain": "Maintenance_Ops_Planner",
      "reason": "no_relevant_evidence"
    }
  ],
  "document_set_plan_required": true,
  "document_set_plan_reason": "新增 API resource 和业务流程，且入口页不能承载正文。",
  "phases": [
    {
      "phase_num": 0,
      "domains_to_activate": ["Data_Model_Planner"],
      "reason": "先稳定底层数据事实。",
      "selection_mode": "router_selected"
    },
    {
      "phase_num": 1,
      "domains_to_activate": ["API_Spec_Planner", "Business_Flow_Planner"],
      "reason": "再更新接口和流程。",
      "selection_mode": "router_selected"
    }
  ],
  "workspace_scope": [],
  "special_flags": ["possibly_breaking"],
  "noise_filters": [],
  "reasoning_summary": "接口和业务流程同时变化，按 structured 流程处理。"
}
```

### Router 规则

- 不写文件。
- 不创建最终文档正文。
- 先按用户意图解析 operation，再按仓库状态兜底。
- `operation=auto` 的输出必须是 resolved operation，不写 `auto`。
- XS/S 默认 `flow_profile=lite`。
- M 默认 `standard`，但有 granularity 风险时启用 `document_set_plan`。
- L 默认 `structured`。
- XL 默认 `partitioned`，必须先识别 workspace / service / package scope 和噪音。
- 七个 domain 隐式考虑；只显式输出 activated 和 material skipped。
- 不因 `.kb_inbox/` 存在自动 ingest。

## 2. Planner

### 目标

把 Router 的范围转换成 target_path 级任务。Planner 只读证据，不写文件。

### Lite task list

XS/S 且 `document_set_plan_required=false` 时，可直接输出：

```json
{
  "tasks": [
    {
      "task_id": "T1",
      "action": "UPSERT",
      "domain": "Infra_Env_Planner",
      "target_path": "docs/ops/config/auth.md",
      "focus_code_entity": "AUTH_SESSION_TTL_SECONDS",
      "evidence_paths": [".env.example", "src/config/auth.ts"],
      "depends_on": [],
      "confidence": "high",
      "clue": "仅默认 TTL 名称变化，更新已有 leaf doc。",
      "scale": "XS",
      "flow_profile": "lite",
      "doc_kind": "substantive"
    }
  ],
  "skipped": []
}
```

### Standard / structured plan

当 `document_set_plan_required=true` 时，先输出 `document_set_plan`，再输出 tasks：

Plan A 要求：

- 先规划完整预期文档集，再派生 tasks。
- 每个 category 必须列 `coverage_basis`、`coverage_assertion`、`scope_boundary`、`excluded_candidates`。
- `leaf_docs` 应覆盖 existing、must、should、candidate；证据不足但有明确信号时使用 `defer` 或 `candidate`，不得省略。
- 不得写“剩余由 Worker 自己发现 / 补充 / 判断”。Worker 只能报告异常溢出。
- 对 API resource、事件族、业务流程、状态机、核心表、跨表事务、配置域、runbook、诊断路径、service/package，必须优先枚举 leaf doc 全集。


```json
{
  "document_set_plan": [
    {
      "category": "api_http_resources",
      "owner_domain": "API_Spec_Planner",
      "index_path": "docs/api/http.md",
      "reason": "新增 orders resource，入口页只做导航。",
      "coverage_basis": ["src/orders/orders.controller.ts", "docs/api/http.md", "docs/api/http/"],
      "coverage_assertion": "Plan A covers all HTTP resources visible in current router scope and existing API docs tree.",
      "scope_boundary": "Only the orders resource is in current changed scope; unrelated admin routes are out of scope.",
      "excluded_candidates": [],
      "leaf_docs": [
        {
          "path": "docs/api/http/orders.md",
          "title": "Orders HTTP API",
          "status": "create",
          "priority": "must",
          "reason": "orders endpoint 有独立 schema、权限和错误边界。",
          "evidence_paths": ["src/orders/orders.controller.ts", "src/orders/dto/create-order.dto.ts"]
        }
      ]
    }
  ],
  "tasks": [
    {
      "task_id": "T-api-orders",
      "action": "UPSERT",
      "domain": "API_Spec_Planner",
      "target_path": "docs/api/http/orders.md",
      "focus_code_entity": "OrdersController",
      "evidence_paths": ["src/orders/orders.controller.ts", "src/orders/dto/create-order.dto.ts"],
      "depends_on": [],
      "confidence": "high",
      "clue": "从 orders resource 的 controller 和 DTO 写 leaf doc。",
      "doc_kind": "substantive",
      "from_document_set_plan": true,
      "document_set_item_path": "docs/api/http/orders.md"
    },
    {
      "task_id": "T-api-index",
      "action": "UPSERT",
      "domain": "API_Spec_Planner",
      "target_path": "docs/api/http.md",
      "focus_code_entity": "API navigation",
      "evidence_paths": ["docs/api/http/orders.md"],
      "depends_on": ["T-api-orders"],
      "confidence": "high",
      "clue": "仅更新入口页链接。",
      "doc_kind": "navigation",
      "index_update_for": ["docs/api/http/orders.md"]
    }
  ],
  "skipped": []
}
```

### Planner 规则

- 不写文件。
- 不发明没有证据的目标。
- 一个 task 只能有一个最终 `target_path`。
- `target_path` 必须是相对路径，不得包含绝对路径、`..`、通配符或 repo 外路径。
- 入口页只能生成 navigation update 任务。
- 如果只有 index 存在但需要写正文，创建 leaf doc task，再创建 index link task。
- `PRUNE` 只能删除普通文件，并且必须有证据和链接检查依据。
- `status=defer` 必须写 `defer_reason`。

## 3. Worker

### 目标

对 exactly one `target_path` 执行 `UPSERT` 或 `PRUNE`。Worker 可以读取相关证据，但只能写自己的 target。

### 输出

```json
{
  "status": "COMPLETED",
  "target_path": "docs/api/http/orders.md",
  "files_read": [
    "src/orders/orders.controller.ts",
    "src/orders/dto/create-order.dto.ts",
    "docs/api/http/orders.md"
  ],
  "files_changed": ["docs/api/http/orders.md"],
  "evidence_gaps": [],
  "warnings": [],
  "edit_mode": "minimal_patch",
  "scenario_notes": ["新增 orders API leaf doc，保留证据边界。"]
}
```

需要补计划时：

```json
{
  "status": "NEEDS_REPLAN",
  "target_path": "docs/api/http.md",
  "files_read": ["src/orders/orders.controller.ts", "docs/api/http.md"],
  "files_changed": [],
  "evidence_gaps": [],
  "warnings": ["入口页任务实际包含 orders resource 正文，不能写入 http.md。"],
  "edit_mode": "no_write",
  "scenario_notes": ["需要 leaf doc。"],
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

### Worker 规则

- 先读现有 target，再写入。
- 默认最小编辑。
- 保留人工段落、备注、TODO、历史上下文、外部链接和有用结构。
- 只有 materially stale、结构阻碍维护或用户要求时，才整体重写。
- `full_rewrite_with_preservation` 必须说明保留和移除内容。
- 不写 secret 值。
- 不创建 repo 外文件。
- 不 stage、commit、push、PR。
- 入口页只写导航、状态和链接。
- Leaf substantive doc 必须包含 `证据与边界`。
- document_set_plan 生效时，不直接创建规划外 leaf doc；只能用 `NEEDS_REPLAN` / `proposed_extra_tasks` 报告异常溢出。
- `proposed_extra_tasks` 不是正常规划机制；不要把 Planner 本应完成的全集规划转移给 Worker。

## 4. Validator

### 目标

只读检查知识库是否安全、一致、可维护。只有 repair=true 或用户明确要求修复时，才能触发后续 Plan/Apply。

### validate-lite 输出

```json
{
  "status": "PASS_WITH_WARNINGS",
  "flow_profile": "lite",
  "checked_scope": ["docs/ops/config/auth.md"],
  "findings": [
    {
      "severity": "info",
      "path": "docs/ops/config/auth.md",
      "issue": "未检查全仓库链接；lite 验证只覆盖变更目标和入口链接。",
      "suggested_repair": "如需全量检查，运行 operation=validate。"
    }
  ]
}
```

### full validate 输出

```json
{
  "status": "FAIL",
  "flow_profile": "structured",
  "checked_scope": ["ACTIONDOCK.md", "docs/api/http.md", "docs/api/http/orders.md"],
  "findings": [
    {
      "severity": "error",
      "path": "docs/api/http.md",
      "issue": "index_content_sink: API 入口页包含 orders resource 的完整 schema。",
      "suggested_repair": "拆分到 docs/api/http/orders.md，并让入口页只保留链接。"
    }
  ]
}
```

### Validator 规则

- 不写、不删、不格式化正文档。
- validate-only 默认不修复。
- XS/S 使用 validate-lite，除非用户要求全量验证。
- M/L/XL 使用 full validate。
- 只对 substantive docs 强制 `证据与边界`。
- navigation/index docs 检查链接、状态和是否承载正文。
- 只有 `document_set_plan_required=true` 时，缺失 document_set_plan 才是 error。
- Worker 的 `proposed_extra_tasks` 必须被执行、defer 或写入 evidence gap。
- 当 `document_set_plan_required=true` 时，Plan A 不得明显少列当前 scope 内可识别的 leaf docs；否则报告 `planner_underplanning`。
- Planner 不得把文档发现职责交给 Worker；否则报告 `delegated_discovery_to_worker`。

## 5. Leader / serial 主控

Leader 负责：

- 选择 execution mode。
- 串联 Router / Planner / Worker / Validator。
- 合并相同 target_path 的任务。
- 保证每个 target_path 只有一个 Worker 写。
- 处理 Worker 的 `NEEDS_REPLAN`。
- 写 report 和必要入口文件。

Leader 不应：

- 绕过 Worker 边界批量写多个 substantive docs。
- 把未验证的 proposed task 当作已完成任务。
- 在用户未授权时 commit、push 或 PR。

## 6. 最终响应格式

完成后向用户汇报：

```text
operation: refresh
execution_mode: serial
flow_profile: lite
changed_files:
- docs/ops/config/auth.md
validation: PASS_WITH_WARNINGS
skipped_or_failed: none
evidence_gaps:
- 未找到生产环境实际 AUTH_SESSION_TTL_SECONDS 值；仅记录变量名和示例来源。
```

不要输出完整内部 prompt、chain-of-thought 或冗长日志。
