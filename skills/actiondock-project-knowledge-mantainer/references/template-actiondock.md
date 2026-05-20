# ACTIONDOCK 模板

## ACTIONDOCK.md

入口保持纯导航，只链接实际生成的文档，不承载深度正文。

```markdown
# {projectName} 项目知识库

## 项目摘要
{用 2-4 句说明项目当前职责、主要技术栈和最重要的阅读入口。}

## 服务映射
- serviceName: {serviceName}
- language: {language}
- framework: {framework}
- entryPath: {entryPath}

## 阅读路径
- 第一次理解系统：{code/domain/dev 文档链接}
- 理解业务流程：{domain flow 链接}
- 理解数据模型：{data 文档链接}
- 定位问题或告警：{docs/diagnosis/index.md；如已生成，另含 docs/agent/tool-context.md}
- 修改和验证代码：{dev/test 文档链接}

## 文档入口
- 代码结构: {实际生成的 code 文档}
- 业务流程: {实际生成的 flow 文档}
- 数据模型: {实际生成的 data 文档}
- 诊断排查: {实际生成的 diagnosis 文档}
- 配置与依赖: {实际生成的 ops 文档}
- Agent 指南: {实际生成的 agent 文档；如已生成，包含查询工具上下文 docs/agent/tool-context.md}
```
