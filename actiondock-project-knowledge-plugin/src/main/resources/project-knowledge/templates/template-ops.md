# 运维与任务模板

## 任务与补偿文档

文件路径：`docs/ops/jobs.md`、`docs/ops/compensation.md`

```markdown
# {jobOrCompensation}

## 类型
{Job / Scheduler / Consumer / Retry / Compensation / Backfill}

## 触发条件
{schedule/topic/manual trigger}

## 处理范围
{what records or business scope}

## 幂等与失败处理
{idempotency key, retry, dead letter, compensation}

## 相关流程和数据
- 流程: {flows}
- 数据表: {tables}

## 证据
- {paths/config}
```

## 运维操作文档

文件路径：`docs/ops/manual-operations.md`

```markdown
# 运维与手动操作

## 操作清单
| 操作 | 入口 | 风险 | 权限 | 前置检查 | 验证/回滚 | 证据 |
|---|---|---|---|---|---|---|
| {operation} | {path/script/admin endpoint} | {risk} | {permission} | {checks} | {verify/rollback} | {paths} |
```
