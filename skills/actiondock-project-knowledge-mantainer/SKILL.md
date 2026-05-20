---
name: actiondock-project-knowledge-mantainer
description: 从本地代码仓库初始化或刷新基于证据的项目知识库。
---

# 项目知识库维护器

## 目标

为本地代码仓库生成或刷新“当前状态”的项目知识库，优先服务新人理解、后续 Agent 检索、SQL 编写和故障排查。所有结论必须绑定仓库中的代码、配置、DDL、测试、日志或已有文档证据；允许有限推断，但必须显式标注依据和不确定性。

默认产物是 `ACTIONDOCK.md`、初始化或更新报告，以及 `docs/` 下的主题文档。完整默认值、输出路径和批处理默认值统一以 `references/knowledge-contract.json` 为准。

## 最小接口

必需输入：
- `repoPath`：目标仓库根目录

常用可选输入：
- `operation`：`init` 或 `refresh`
- `evidenceFiles`：手工指定的一批补充证据文件或目录
- `resume`：是否从 checkpoint 继续

完整输入清单、默认值、正式产物路径和临时目录约束，全部读取 `references/knowledge-contract.json`，不要在这里重复维护常量。

## 加载顺序

按下面顺序读取，避免一次性加载无关上下文：

1. `references/knowledge-contract.json`：输入默认值、输出路径和批处理默认值
2. `references/workflow.md`：阶段顺序、写入边界、batch/resume 流程
3. `references/scan-domains.md`：域激活条件、输出映射、优先级启发式
4. `references/templates.md`：根据当前域选择具体模板文件
5. `references/quality-gates.md`：正式写入前的语义质量门

只在需要时再读取具体模板文件，不要预加载全部模板。

## 运行约束

- 只描述当前状态；历史演进、迁移流水账、ADR 回顾、发布记录默认不写。
- 只在有证据时生成或更新正文；证据不足时写入报告，不生成伪完整文档。
- `ACTIONDOCK.md` 只做导航；`index.md` 只做索引，不承载长篇正文。
- 发现阶段只读仓库；领域草稿只写 `.knowledge-tmp/`；正式文档只在汇总阶段写入。
- 正式文档不得引用 `.knowledge-tmp/` 或要求读者查看临时产物。
- `evidenceFiles` 只作为补充证据来源；仓库中的当前代码、配置和结构事实优先级更高。
- `evidenceFiles` 不要求统一格式；允许部分吸收、跨主题吸收和按需跳过。
- `schema_evidence`、`diagnosis_fragments`、`tool_context`、`repo_facts`、`generation_prefs`、`unknown_notes` 这些词只作为思考和写作提示，不要求把每份证据固定落入标签或序列化结构。
- 不自动 stage、commit、push 或创建 PR。
- 不记录真实 token、secret、password、私钥或完整连接串，只记录键名、用途、来源和脱敏示例。

## 失败处理

- 流程、表、诊断场景或运行知识证据不足时，保留候选项并在报告中说明缺口，不编造正文。
- 批次失败、跳过或需要人工复核时，更新 checkpoint 并继续后续批次；不要因为单批失败阻塞整体。
- 无法可靠解析的 `evidenceFiles`、无法归类的片段或与代码冲突的外部材料，跳过并在报告中说明原因。
- 报告必须按来源说明外部证据的吸收与跳过结果；`.knowledge-tmp/` 可保留自由格式摘要辅助当前轮次，但不形成长期契约。
- `resume` 时重新读取 `evidenceFiles`，不要把上轮临时摘要当成事实来源。
- 汇总后做人工质量检查：断链、占位符、临时目录引用、覆盖统计和明显浅文档。只有确认不需要继续 resume 时，才删除 `.knowledge-tmp/`。

## 非目标

除非用户明确要求，否则不要生成：
- 迁移历史或变更流水账
- 发布历史
- ADR 或设计回顾
- 已废弃方案对比
- 与当前行为无关的历史知识
