# 数据模型模板

## 数据模型索引

文件路径：`docs/data/index.md` 或 `docs/data/schema.md`

```markdown
# 数据模型

## DDL 覆盖情况
- DDL 来源: {ddl paths or provided input}
- DDL 表总数: {total create table count}
- 已生成表文档: {generated table doc count}
- 跳过表: {skipped table count}

## 语义覆盖情况
- 字段总数: {field count}
- 已确认语义字段: {confirmed semantic count}
- 语义证据不足字段: {uncertain semantic count}
- 状态/枚举字段: {status enum field count}
- DDL 注释冲突: {conflict count}

## 表清单
| 表名 | 文档 | 来源 | 结构完整性 | 字段语义状态 | 状态/枚举覆盖 | 主要读写流程 |
|---|---|---|---|---|---|---|
| {table} | docs/data/tables/{table}.md | {DDL/ORM} | {complete/partial} | {confirmed/partial/uncertain} | {confirmed/partial/none} | {flows} |

## 关键缺口
| 表/字段 | 缺口 | SQL 风险 | 处理建议 |
|---|---|---|---|
| {table.field} | {missing semantic/status/index evidence} | {risk} | {next action} |

## 跳过表
| 表名 | 原因 | 处理建议 |
|---|---|---|
| {table} | {parse conflict / duplicate / user excluded} | {next action} |
```

## 数据表文档

文件路径：`docs/data/tables/{table-name}.md`

当存在完整 DDL 时，必须为 DDL 中每个 `CREATE TABLE` 生成一个数据表文档。DDL 用于确认结构；表职责、字段含义、状态含义和读写关系必须以当前代码实现为准。没有业务语义代码证据的字段不能留空，写“语义证据不足”。

```markdown
# {tableName}

## 当前职责
{解释这张表/实体在当前系统中的业务职责；无法从代码确认时明确说明缺少证据。}

## 新人先读
- {Entity/Model}: {path and reason}
- {Repository/Mapper}: {path and reason}
- {写入它的 Service/Flow}: {path and reason}

## 完整表结构
| 字段 | 数据库类型 | 可空 | 默认值 | 主键 | 外键 | 唯一 | 索引 | ORM 字段 | 来源 |
|---|---|---|---|---|---|---|---|---|---|
| {column} | {db type} | {yes/no/unknown} | {default/null/none/unknown} | {yes/no} | {target table.column/no/unknown} | {constraint name/no} | {index names/no} | {entity field/no} | {DDL/ORM/source path} |

## 约束和索引
- 主键: {primary key columns and source}
- 外键: {foreign keys and source}
- 唯一约束: {unique constraints and source}
- 普通索引: {indexes, column order, source}
- 检查约束: {check constraints if present}

## 字段语义
| 字段 | 当前含义（以代码为准） | DDL 注释 | 谁写入 | 谁读取 | 诊断价值 | 语义依据 |
|---|---|---|---|---|---|---|
| {field} | {meaning from code or 语义证据不足} | {ddl comment if any} | {writer or unknown} | {reader or unknown} | {how to use in SQL/diagnosis or risk} | {Entity/Service/Mapper/Test/Log path or missing evidence} |

## 状态、类型和标志位取值
| 字段 | 取值 | 当前含义 | 进入/设置条件 | 离开/变化条件 | 写入代码 | 读取代码 | 相关流程 | 不确定项 |
|---|---|---|---|---|---|---|---|---|
| {status/type/flag field} | {value} | {meaning from code} | {enter/set condition} | {leave/change condition} | {path/symbol} | {path/symbol} | {flow doc} | {missing evidence} |

## 读写关系
| 流程/模块 | 读/写 | 字段 | 时机 | 条件 | 证据 |
|---|---|---|---|---|---|
| {flow/module} | {read/write} | {fields} | {when} | {condition} | {path/symbol} |

## SQL 编写注意事项
- 物理表名: {physical table name}
- schema/database: {schema or database if present}
- 字符集/排序规则: {charset/collation if present}
- 自增/序列: {auto increment or sequence if present}
- 时间字段策略: {created/updated/deleted fields if present}
- 软删除字段: {field and semantics if present}
- 租户/分片字段: {tenant/sharding fields if present}
- 查询过滤建议: {status/deleted/tenant/time filters proven by code}
- Join 关系: {related tables and join keys}
- SQL 风险: {uncertain semantics, missing indexes, conflicting comments}

## DDL 注释校正
| 表/字段 | DDL 注释 | 代码实现体现的含义 | 处理 |
|---|---|---|---|
| {table_or_field} | {ddl comment} | {meaning from code} | {use code / uncertain / no conflict} |

## 一致性和诊断
{事务、索引、唯一约束、缓存、补偿和常见数据异常排查。}

## 边界与非职责
{说明不应从这张表推断什么，或哪些含义需要其他表共同确认。}

## 证据与不确定性
- 证据: {DDL/Entity/Mapper/Service/Test/Log paths}
- 有限推断: {如有，说明依据}
- DDL 注释冲突: {如有，说明以哪个代码证据为准}
- 语义证据不足: {field list and missing evidence}
- 结构不确定: {type/default/index/constraint uncertainties}
```
