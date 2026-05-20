# 报告模板

## 初始化报告

文件路径：`KNOWLEDGE_INIT_REPORT.md`

```markdown
# 知识库初始化报告

## 摘要
本次初始化为 {projectName} 生成当前状态知识库，目标读者为 {audience}。

## 已生成文件
- {generated file}: {内容深度和用途}

## 跳过文件
- {skipped file}: {证据不足的具体原因}

## 业务流程覆盖情况
- 候选流程总数: {candidate flow count}
- 已生成流程文档: {generated flow docs}
- 跳过流程: {skipped flows with reasons}

## 数据库语义覆盖情况
- DDL 表总数: {total create table count}
- 已生成表文档: {generated table docs}
- 跳过表: {skipped tables with reasons}
- 字段语义确认率: {confirmed fields / total fields}
- 状态/枚举字段: {status enum fields}
- 语义证据不足字段: {uncertain key fields}
- DDL 注释冲突: {conflicts}

## 查询工具上下文覆盖情况
- 工具上下文适配器: {generated adapters or missing}
- 工具上下文文档: {docs/agent/tool-context.md generated/skipped with reason}

## 外部证据吸收情况
| 来源 | 吸收到哪些文档/主题 | 跳过了什么 | 跳过或冲突原因 |
|---|---|---|---|
| {source path} | {docs or themes} | {skipped content summary} | {reason} |

## 使用证据
- {path}: {证明了什么}

## 检测到的项目事实
- 语言: {languages}
- 框架: {frameworks}
- 模块: {modules}
- API: {facts}
- 数据库: {facts}
- 缓存: {facts}
- 消息队列: {facts}
- 外部依赖: {facts}

## 运行知识覆盖情况
- 业务规则: {generated/skipped with reason}
- 状态机: {generated/skipped with reason}
- 外部依赖: {generated/skipped with reason}
- 任务与补偿: {generated/skipped with reason}
- 观测与告警: {generated/skipped with reason}
- SQL 排查手册: {generated/skipped with reason}
- 日志排查手册: {generated/skipped with reason}
- 运维操作: {generated/skipped with reason}

## 有限推断
- {conclusion}: {evidence and confidence}

## 不确定区域
- {area}: {缺少什么证据}

## 需要人工审查
- {item}: {原因}
```

## 更新报告

文件路径：`KNOWLEDGE_UPDATE_REPORT.md`

```markdown
# 知识库更新报告

## 摘要
本次根据当前代码刷新 {projectName} 知识库，重点处理新增、变更、过期和证据不足项。

## 更新文件
- {updated file}: {更新原因和证据}

## proposed 文件
- {proposed file}: {原文件保护原因}

## 新增证据
- {path/symbol}: {影响哪些文档}

## 过期或冲突结论
- {doc section}: {旧结论、当前代码证据、处理方式}

## 业务流程变化
- 新增流程: {flows}
- 更新流程: {flows}
- 跳过/证据不足流程: {flows with reasons}

## 诊断知识变化
- SQL 排查场景: {added/updated/skipped scenarios}
- 日志排查场景: {added/updated/skipped scenarios}
- 组合排查步骤: {added/updated/skipped runbook steps}

## 数据库语义变化
- 新增/删除/变更表: {tables}
- 新增/删除/变更字段: {fields}
- 状态/枚举变化: {status enum changes}
- 语义证据不足字段: {uncertain key fields}
- DDL 注释冲突: {conflicts}

## 查询工具上下文变化
- 工具上下文适配器: {added/changed/unchanged/missing adapters}

## 外部证据变化
| 来源 | 本次影响 | 跳过或冲突内容 | 说明 |
|---|---|---|---|
| {source path} | {added/updated docs or themes} | {summary} | {reason} |

## 需要人工审查
- {item}: {原因}
```
