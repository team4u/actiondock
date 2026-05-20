# 诊断模板

## 观测与告警文档

文件路径：`docs/diagnosis/observability.md`

```markdown
# 观测与告警

## 关键日志字段
- {field}: {meaning and source}

## 指标与告警
| 指标/告警 | 触发条件 | 相关流程 | 排查入口 | 证据 |
|---|---|---|---|---|
| {metricOrAlert} | {condition} | {flows} | {logs/dashboards/code} | {paths} |

## 推荐排查顺序
1. {step}
2. {step}
3. {step}
```

## 诊断索引

文件路径：`docs/diagnosis/index.md`

诊断域激活时必须生成或更新。索引只做导航和排查入口，只链接实际存在或本次生成的诊断文档。

```markdown
# 诊断排查

## 快速入口
| 入口 | 适用场景 | 文档 |
|---|---|---|
| 问题级排查 | 需要按现象组合使用 SQL、日志、配置、任务或接口证据 | {runbook link if exists} |
| SQL 排查 | 需要复用数据查询片段或解释 SQL 结果 | {sql playbook link if exists} |
| 日志排查 | 需要复用日志查询、关键字、错误码或 trace 字段 | {log playbook link if exists} |
| 日志与异常 | 需要理解日志字段、异常类型或错误码 | {logs/exceptions links if exist} |
| 观测与告警 | 需要从指标、告警或 dashboard 开始排查 | {observability/alerts links if exist} |

## 问题场景索引
| 问题场景 | 主要现象 | 首选入口 | 相关 SQL | 相关日志 | 相关流程/表 |
|---|---|---|---|---|---|
| {scenario} | {symptom} | {runbook anchor or doc} | {sql playbook anchor} | {log playbook anchor} | {flow/table docs} |

## 工具上下文
- {tool context link if exists}: 数据库和日志查询工具必填参数。

## 证据缺口
| 区域 | 缺口 | 影响 | 后续处理 |
|---|---|---|---|
| {area} | {missing evidence} | {diagnosis risk} | {next action} |
```

## 问题级排查 Runbook

文件路径：`docs/diagnosis/runbook.md`

用于按问题现象组织组合排查流程。SQL 和日志查询正文优先放在 playbook 中，runbook 通过链接引用。

```markdown
# 问题级排查 Runbook

## 场景清单
| 问题场景 | 适用现象 | 优先级 | 相关 SQL | 相关日志 | 查询入口 |
|---|---|---|---|---|---|
| {scenario} | {symptom} | {high/normal/low} | {sql playbook anchor} | {log playbook anchor} | {section anchor} |

## {scenario}

### 适用现象
{what users, alerts, jobs, or operators observe}

### 先确认
| 检查项 | 方法 | 正常表现 | 异常表现 |
|---|---|---|---|
| {check} | {how to check} | {normal} | {abnormal} |

### 排查步骤
1. {log/config/API/job first step with link}
2. {SQL/data step with link}
3. {correlate results and decide next branch}
4. {next action: retry/compensate/escalate/fix data/observe}

### 判断矩阵
| 日志结果 | SQL/数据结果 | 结论 | 下一步 |
|---|---|---|---|
| {log result} | {data result} | {diagnosis} | {next action} |

### 关联知识
- 流程: {flow docs}
- 表: {table docs}
- SQL: {sql playbook anchors}
- 日志: {log playbook anchors}
- 工具上下文: {tool context link if exists}

### 风险与边界
- {risk or boundary}

### 证据与不确定性
- 证据: {code/log/sql/user input docs}
- 不确定: {missing evidence}
```

## SQL 排查手册

文件路径：`docs/diagnosis/sql-playbook.md`

不要只堆 SQL 列表；每条必须说明适用场景、参数、结果解释和误用风险。

````markdown
# SQL 排查手册

## 场景清单
| 场景 | 目的 | 相关流程 | 相关表 | 查询入口 |
|---|---|---|---|---|
| {scenario} | {why run it} | {flow doc} | {table docs} | {section anchor} |

## {scenario}

### 适用条件
{when this SQL should be used}

### 查询参数
| 参数 | 含义 | 来源 | 必填 |
|---|---|---|---|
| {param} | {meaning} | {request/log/table/config} | {yes/no} |

### SQL
```sql
{sql}
```

### 结果解释
| 字段 | 含义 | 异常判断 | 后续动作 |
|---|---|---|---|
| {column} | {meaning} | {abnormal condition} | {next step} |

### 关联知识
- 流程: {flow docs}
- 表: {table docs}
- 日志: {log playbook or log docs}

### 风险与边界
- {risk or boundary}

### 证据与不确定性
- 证据: {source SQL/user input/code paths/table docs}
- 不确定: {missing evidence}
````

## 日志排查手册

文件路径：`docs/diagnosis/log-playbook.md`

工具调用必填参数只引用 `docs/agent/tool-context.md`，不要在每个场景重复维护。

````markdown
# 日志排查手册

## 场景清单
| 场景 | 目的 | 关键字/字段 | 相关流程 | 查询入口 |
|---|---|---|---|---|
| {scenario} | {why run it} | {keywords or fields} | {flow doc} | {section anchor} |

## {scenario}

### 适用条件
{when this log query should be used}

### 查询条件
| 条件 | 含义 | 来源 | 必填 |
|---|---|---|---|
| {condition} | {meaning} | {request/log/config} | {yes/no} |

### 日志查询
```text
{log query or keyword expression}
```

### 结果解释
| 命中内容 | 含义 | 异常判断 | 后续动作 |
|---|---|---|---|
| {log field or message} | {meaning} | {abnormal condition} | {next step} |

### 关联知识
- 流程: {flow docs}
- SQL: {sql playbook or table docs}
- 工具上下文: `docs/agent/tool-context.md`

### 风险与边界
- {risk or boundary}

### 证据与不确定性
- 证据: {logger paths/user input/error codes/config keys}
- 不确定: {missing evidence}
````
