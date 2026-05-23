# Changelog

## 4.2.0

- 将执行策略从“`native_subagent`/`serial` 二选一”改为契约化的 `subagent_required`、`subagent_preferred`、`serial_only`，默认值为 `subagent_required`。
- 在 `contract.json` 中新增 `executionModes`、`defaultExecutionMode`、`executionPolicy`，并补充真实执行模式、能力信号优先级、required failure message、serial fallback 触发条件。
- 更新 `SKILL.md` 和 `playbook.md`，明确 subagent 是支持环境下的强制执行模型，不再把它描述为纯优化项。
- 更新 `prompts.md`，新增 `Role Execution Boundary`，要求 Router / Planner / Worker / Validator 在 `subagent_required` 下必须作为真实子代理隔离执行。
- 更新 `ACTIONDOCK` 模板与报告字段，新增 `execution_policy`，保留 `execution_mode` 用于记录实际运行方式。

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
