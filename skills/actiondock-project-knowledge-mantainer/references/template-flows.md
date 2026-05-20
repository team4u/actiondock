# 业务流程、规则和状态机模板

## 业务流程索引

文件路径：`docs/domain/flows/index.md`

```markdown
# 业务流程索引

## 覆盖情况
- 候选流程总数: {candidate flow count}
- 已生成流程文档: {generated flow doc count}
- 跳过流程: {skipped flow count}

## 流程清单
| 流程 | 文档 | 类型 | 业务目标 | 触发入口 | 核心用例 | 主要状态 | 主要数据表 | 外部依赖 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| {flow} | docs/domain/flows/{flow}.md | {HTTP/Job/MQ/Webhook/Internal/Manual} | {goal} | {entry} | {service method} | {states} | {tables} | {deps} | {paths} |

## 跳过流程
| 候选流程 | 触发/证据 | 跳过原因 | 处理建议 |
|---|---|---|---|
| {flow} | {path/symbol} | {duplicate / insufficient evidence / user excluded} | {next action} |
```

## 业务流程文档

文件路径：`docs/domain/flows/{flow-name}.md`

一篇流程文档对应一个端到端业务用例。不能只写接口摘要或几行说明；如果证据不足以满足以下结构，把候选项留在流程索引的“跳过流程”。

```markdown
# {flowName}

## 这条流程解决什么问题
{解释业务目标、触发者、最终产出，以及为什么这是一条独立流程。}

## 新人先读
- {Controller/Router/Job/Consumer}: {path and reason}
- {Service/UseCase}: {path and reason}
- {Repository/Mapper/Client/Event}: {path and reason}

## 流程身份
- 流程类型: {HTTP / Job / MQ / Webhook / Internal use case / Compensation / Manual}
- 业务目标: {business goal}
- 触发入口: {endpoint/topic/schedule/callback/method}
- 核心用例: {Service/UseCase method}
- 主要数据表: {tables}
- 主要状态: {states}
- 外部依赖: {dependencies}

## 触发方式和输入
{说明请求、消息、任务、回调或人工入口的输入形状、关键参数、权限或上下文来源。}

## 输入校验和业务规则
- {rule/check}: {where enforced, failure behavior, evidence}

## 主流程
1. {入口接收什么输入}
2. {入口如何路由到核心用例}
3. {核心校验或分支}
4. {业务状态如何变化}
5. {读写哪些数据和字段}
6. {调用哪些外部依赖或发布哪些事件}
7. {返回什么结果或产生什么副作用}

## 关键分支和异常路径
| 条件 | 行为 | 错误/补偿 | 证据 |
|---|---|---|---|
| {condition} | {behavior} | {error/retry/compensation} | {path/symbol} |

## 调用链
```text
{entry} -> {Controller/Handler} -> {Service/UseCase} -> {Repository/Client/Event} -> {side effect}
```

## 状态变化
| 对象/字段 | 从 | 到 | 触发条件 | 代码证据 | 相关状态机 |
|---|---|---|---|---|---|
| {entity.status} | {from} | {to} | {condition} | {path/symbol} | {doc link} |

## 数据读写
| 表/实体 | 读/写 | 关键字段 | 时机 | 事务/一致性影响 | 证据 |
|---|---|---|---|---|---|
| {table/entity} | {read/write} | {fields} | {when} | {transaction/idempotency/lock} | {path/symbol} |

## 外部依赖和事件
| 依赖/事件 | 调用目的 | 请求/消息含义 | 失败处理 | 证据 |
|---|---|---|---|---|
| {dependency/event} | {purpose} | {shape/meaning} | {timeout/retry/fallback} | {path/config} |

## 幂等、事务和一致性
{说明幂等键、唯一约束、锁、事务边界、补偿、重试、重复消息处理；没有证据的项省略。}

## 日志、错误和排查入口
- 日志关键词: {log pattern, field, code path}
- 错误码/异常: {meaning, branch, code path}
- 排查顺序: {where to inspect first}

## 边界与非职责
{说明这条流程不处理什么、依赖哪个上游/下游处理。}

## 常见误解
- {misread}: {correction and evidence}

## 相关文档
- {doc path}: {why related}

## 证据与不确定性
- 证据: {paths/symbols/tables/config}
- 有限推断: {如有，说明依据}
- 不确定: {如有，说明缺失证据}
```

## 业务规则文档

文件路径：`docs/domain/rules.md`

```markdown
# 业务规则

## 覆盖范围
{这些规则覆盖哪些核心对象、流程和边界。}

## 规则清单
| 规则 | 适用对象 | 触发流程 | 规则内容 | 违反后行为 | 证据 |
|---|---|---|---|---|---|
| {rule} | {object} | {flows} | {constraint} | {error/branch} | {paths} |

## 不变量
- {invariant}: {where enforced and why}

## 常见误解
- {misread}: {correct meaning and evidence}
```

## 状态机文档

文件路径：`docs/domain/state-machines/{name}.md`

```markdown
# {stateMachineName}

## 对象
{entity or aggregate}

## 状态清单
| 状态 | 当前含义 | 进入条件 | 离开条件 | 证据 |
|---|---|---|---|---|
| {state} | {meaning} | {enter} | {leave} | {paths} |

## 状态迁移
| 从 | 到 | 触发流程 | 关键代码 | 失败/补偿 |
|---|---|---|---|---|
| {from} | {to} | {flow} | {path} | {fallback} |

## 禁止迁移
- {invalid transition}: {why and evidence}
```
