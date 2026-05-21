# 外部依赖模板

## 外部依赖文档

文件路径：`docs/integrations/{name}.md`

```markdown
# {integrationName}

## 业务目的
{why this dependency exists}

## 调用方与入口
- {service/method}: {path}

## 契约
- 协议: {HTTP / RPC / MQ / Webhook / SDK}
- 请求: {shape}
- 响应: {shape}
- 认证: {auth}

## 运行规则
- 超时: {timeout source}
- 重试: {retry source}
- 降级/兜底: {fallback}
- 失败处理: {error handling}

## 相关流程
- {flow}: {why}

## 证据与不确定性
- 证据: {paths/config}
- 不确定: {missing info}
```
