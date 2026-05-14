# 项目知识库解析

当问题依赖某个业务项目自身的文档、数据库说明、流程说明或 runbook 时，先不要直接扫源码，先通过 ActionDock 解析项目知识入口。

## 目标

用最少的平台能力，稳定拿到：

1. 目标项目仓库的根目录
2. 项目知识入口文件位置
3. 知识入口文件的原始 Markdown 内容

## 标准命令

先列出项目仓库：

```bash
actiondock repository list --purpose project --json
```

再解析具体项目：

```bash
actiondock repository resolve --project <projectId-or-alias> --json
```

`<projectId-or-alias>` 可以是：

- 仓库 ID
- 项目标识别名

## 返回结果理解

典型返回：

```json
{
  "projectId": "billing-service",
  "repositoryId": "billing-service",
  "type": "LOCAL_DIR",
  "purpose": "PROJECT",
  "root": "/Users/code/projects/billing-service",
  "markerPath": ".actiondock/PROJECT.md",
  "enabled": true,
  "exists": true,
  "content": "---\nproject_id: billing-service\n---\n\n# Billing Service\n..."
}
```

重点字段：

- `root`: 项目根目录
- `markerPath`: 项目知识入口文件，相对项目根目录
- `content`: `PROJECT.md` 原始内容

## 工作流

### 1. 先读 `content`

`content` 通常会告诉你：

- 项目概览
- 哪些知识文档优先阅读
- 某类任务应该优先看哪些文件
- 推荐关键词
- 哪些目录不要优先搜索

### 2. 优先读 Markdown 知识文件

如果正文提到这些文件，优先读：

- `overview.md`
- `database.md`
- `workflows.md`
- `runbooks/`

或者正文里提到的更细粒度文件，例如：

- `workflows/refund.md`
- `runbooks/refund-compensation.md`

### 3. 只在必要时读源码

源码只有在以下场景再看：

- Markdown 没覆盖该问题
- 需要确认真实实现细节
- 文档和实现疑似不一致

### 4. 避免低价值目录

如果 `PROJECT.md` 没给出更具体规则，默认不要优先搜索：

- `dist`
- `build`
- `node_modules`
- `.git`

## 回答用户时要体现的依据

如果结论依赖项目知识库，回答里应明确指出依据来自：

- `PROJECT.md`
- 具体的 Markdown 文档
- 必要时补充源码文件

## 术语

- `PROJECT.md`: 项目知识入口文件
- `project repository`: 被注册为 `purpose=PROJECT` 的仓库
