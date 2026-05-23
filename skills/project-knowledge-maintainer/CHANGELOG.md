# Changelog

## 4.4.5 - All-stage delegate gates

- Expanded delegate wait gates from Worker-centric enforcement to every dispatched stage: Router, workspace/noise filter, Planner, Document Set Planner, Task Planner, Worker, Validator, Repair, Cleanup, and Reporter.
- Leader may not self-complete any dispatched stage because a team agent or subagent is slow, pending, or not yet returned.
- Added stage-level delegate dispatch/reporting expectations: `stage`, `delegate_type`, `delegate_status`, `result_received`, and `result_summary`.
- Added validator finding: `stage_delegate_not_dispatched`.
- Added fixture: `examples/all-stage-delegate-gate/`.

## 4.4.4 - Team delegate wait gates

- Added mandatory delegate wait gates for team_agent and native_subagent execution.
- Leader must wait for Router / Planner / Worker / Validator delegate results before dependent phases proceed.
- Slow, pending, or not-yet-returned delegates are not valid serial fallback reasons.
- Added report requirements for delegate_status and result_received.
- Added validator findings: delegate_result_missing and delegate_wait_bypassed.
- Added fixture: examples/delegate-wait-gate/.


## 4.4.3

- Added `team_agent` as the preferred execution mode when the host supports team-agent / multi-agent-team orchestration.
- Generalized Worker dispatch from Worker subagents to Worker delegates: team agent member, team task, native subagent, or equivalent isolated execution unit.
- Set execution priority to `team_agent` > `native_subagent` > `serial`; serial remains a fallback only.
- Added `worker_delegate_not_dispatched` as the main validation finding, while keeping `worker_subagent_not_dispatched` as a compatibility alias.
- Added `examples/team-agent-delegate-dispatch` to catch Leader batch-writing when team agents are available.

## 4.4.2

- Strengthened native subagent execution: when native subagents are available and not forbidden, each writable `target_path` must be dispatched to a dedicated Worker subagent.
- Clarified that serial execution is a fallback, not a shortcut around Worker boundaries.
- Added `worker_dispatch` reporting expectations and a `worker_subagent_not_dispatched` validation finding.
- Clarified that Leader may orchestrate, de-duplicate tasks, and write reports/entry navigation, but should not batch-write substantive docs in native_subagent mode.

## 4.4.1

- Tightened `document_set_plan_required=true` into Plan A: Planner must enumerate the complete expected leaf-doc set before Worker execution.
- Added required Plan A completeness fields: `coverage_basis`, `coverage_assertion`, `scope_boundary`, and `excluded_candidates`.
- Clarified that `proposed_extra_tasks` is an overflow/replan mechanism, not a normal way for Planner to delegate document discovery to Worker.
- Added Validator findings: `planner_underplanning` and `delegated_discovery_to_worker`.
- Added `examples/planner-underplanning` to catch lazy Planner behavior.


## 4.4.0

- Replaced the fixed `Route → Document Set Plan → Task Plan → Apply → Validate` requirement with adaptive flow profiles: `lite`, `standard`, `structured`, `partitioned`, and `validate_only`.
- Kept hard safety boundaries unchanged: path containment, secret protection, repo evidence priority, no commit/push/PR, and untrusted repo text.
- Made `document_set_plan` scale/risk-triggered instead of mandatory for every task. XS/S updates can now use route-lite and validate-lite.
- Added `flow_profile`, `document_set_plan_required`, `document_set_plan_reason`, `proposed_extra_tasks`, and `NEEDS_REPLAN` semantics.
- Relaxed domain coverage output: all seven domains are still implicitly considered, but XS/S no longer need mechanical skipped-domain lists.
- Updated Planner, Worker, and Validator contracts so Worker can propose missing leaf docs without directly creating unplanned documents.
- Updated granularity and validation rules to treat missing `document_set_plan` as an error only when it was required.
- Reframed the skill for Codex-style coding agents: safety remains strict, but simple changes avoid unnecessary planning overhead.

## 4.3.0

- Added `references/document-set-planning.md`.
- Planner must now output `document_set_plan` before write tasks.
- Added child-document statuses: `create`, `update`, `keep`, `defer`, `deprecate`, `prune_candidate`.
- Added validation findings: `missing_required_leaf_doc`, `index_without_leaf_docs`, `category_under_split`, `document_set_plan_missing`, `unplanned_leaf_doc`.
- Added document-set planning examples for flows, API, data, monorepo, and under-split validation.


## 4.2.0

- Added `references/document-granularity.md`.
- Enforced navigation-only semantics for `index.md`, `ACTIONDOCK.md`, entry-style `http.md` / `events.md`, and workspace indexes.
- Required leaf substantive docs for named flows, API resource groups, tables, transactions, config domains, runbooks, diagnosis paths, services, and packages.
- Added `index_content_sink` validator finding for index pages that become long-form content containers.
- Updated Planner/Worker/Validator contracts to prevent appending full content into index docs.
- Added granularity examples for flow, API, config, and validator violation cases.

## 4.1.1

- 将 `contract.json` 的 `version` 改为字符串，并统一 `release` 为 `4.1.1`。
- 调整 `operation=auto` 解析优先级：先尊重用户明确意图，再根据仓库状态选择 `init` 或 `refresh`。
- 修正 `phaseDefaultsByScale` 中的 `router_selected_minimal` 占位符，改为 `domains_to_activate: []` 加 `selection_mode`。
- 增加 `noiseFilterClassificationValues` 枚举，并要求 `noise_filters[].classification` 使用枚举值。
- 补充场景矩阵和 Validator 中的 changedFiles 降噪校验说明。

## 4.1.0

- 将 skill 名称、目录名和 contract name 统一为 `project-knowledge-maintainer`，去掉旧版本名称后缀。
- 明确 `operation=auto` 是合法输入；Router 必须解析为 `init`、`refresh`、`ingest` 或 `validate`。
- 补齐旧示例的 v4 Router 字段：`scale`、`change_types`、`workspace_scope`、`special_flags`、`noise_filters`。
- 放松 L/XL phase 规则：API-only 大更新可以跳过无关 Data/Infra phase，但 Architecture/ACTIONDOCK 仍最后汇总。
- 重写 `ACTIONDOCK` 模板示例，避免模型照抄不存在的链接。
- 给 `contract.json` 补充 `name` 与 `description`。

## 4.0.0

- 新增 `references/scenario-matrix.md`：覆盖 XS/S/M/L/XL、小更新、大更新、超大仓库、rename、breaking、stale、降噪规则。
- 新增 `references/validator.md`：基础验证和真实项目场景专项检查。
- 更新 `contract.json` 到 version 4，新增 scale、change_types、workspace_scope、special_flags、noise_filters、edit_mode 等契约字段。
- 更新 `SKILL.md`、`playbook.md`、`prompts.md`、`domain-map.md`、`evidence-search.md`、`actiondock-template.md`。
- 新增场景测试夹具：`xs-env-change`、`m-new-feature`、`l-api-v2-migration`、`xl-monorepo-refresh`、`rename-move`、`stale-doc-refresh`。

## 3.0.0

- 增加推荐调用格式，降低触发歧义。
- 增加 `references/evidence-search.md`，覆盖常见技术栈证据发现路径。
- 重构 `ACTIONDOCK.md` 模板为“已建立 / 待建立 / 不适用”，避免初始化制造断链。
- 明确 `PRUNE` 与 `.kb_inbox/` cleanup 规则。
- 区分 substantive docs 与 navigation/index docs，Validator 不再对纯导航页强制要求证据区。
- 强化最小编辑原则，保护人工内容，避免 refresh 大规模重写。
- 增加 `examples/` 测试夹具，覆盖 init、refresh、ingest、validate 四类场景。
