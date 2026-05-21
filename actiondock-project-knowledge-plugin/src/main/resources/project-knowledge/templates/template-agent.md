# Agent 模板

## Agent 指南

只在有足够项目证据时生成这些文件：
- `docs/agent/alert-diagnosis.md`
- `docs/agent/code-search.md`
- `docs/agent/knowledge-update.md`
- `docs/agent/tool-context.md`
- `docs/agent/shell-policy.md`

这些文档必须基于项目事实说明如何读、搜、诊断和更新知识库。`shell-policy.md` 必须来自安全分析结果，不能用通用模板硬写。

## 通用 Agent 指南文档

适用于 `docs/agent/alert-diagnosis.md`、`docs/agent/code-search.md`、`docs/agent/knowledge-update.md`。

```markdown
# {agentGuideName}

## 目标
{this guide helps an agent do what}

## 先看什么
- {doc/link/path}: {why}

## 最小工作流
1. {step}
2. {step}
3. {step}

## 必查证据
- {path/symbol/config/table}: {what it proves}

## 常见误判
- {mistake}: {correction and evidence}

## 边界与升级
- {when to stop, when to escalate, what not to infer}
```

## 查询工具上下文

文件路径：`docs/agent/tool-context.md`

只在发现至少一个真实工具上下文适配器时生成。不得填占位值；缺失字段写入“缺失项与影响”和报告。

工具上下文来自仓库证据或 `evidenceFiles` 中能支持工具使用规则的片段。字段名不预设为某一套固定参数；按实际识别出的工具适配器和参数落地。

```markdown
# 查询工具上下文

## 工具适配器

### {adapterName}

适用工具：{tool names}

| 参数 | 值 | 证据 |
|---|---|---|
| {field} | {value} | {repo path / config / evidence file} |

## 使用规则
- {rule}
- {rule}

## 缺失项与影响
| 字段 | 缺失原因 | 影响 | 后续处理 |
|---|---|---|---|
| {field} | {missing evidence} | {tool call risk} | {needed source} |

## 证据与不确定性
- 证据: {来自仓库配置、代码或 evidenceFiles 的工具上下文片段}
- 不确定: {missing or conflicting evidence}
```
