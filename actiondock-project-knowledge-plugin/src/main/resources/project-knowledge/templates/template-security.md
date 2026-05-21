# 安全文档模板

## 安全主题文档

适用于 `docs/security/*.md`，用于记录认证、授权、敏感操作和安全边界。

```markdown
# {topic}

## 安全目标
{说明该文档帮助读者避免什么风险。}

## 入口与边界
- {path or symbol}: {它暴露了什么能力}

## 认证与授权
- {mechanism}: {证据和限制}

## 敏感操作
- {operation}: {触发条件、保护措施、风险}

## 审计与追踪
- {log or event}: {如何追踪}

## 禁止推断
- {missing evidence}: {为什么不能默认推断}

## 证据与不确定性
- 证据: {path/symbol/config}
- 不确定: {missing or conflicting evidence}
```
