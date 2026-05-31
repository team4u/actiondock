# 任务手册（Playbook）

任务手册是 ActionDock 平台内的任务导览资产。中文 UI 使用“任务手册”，CLI、API 和代码里统一使用 `playbook`。

Playbook 只回答：

- 这是什么任务
- 建议先看哪些知识
- 建议用哪些脚本
- 建议怎么走
- 什么时候别继续

Playbook 不是步骤 DSL，也不是执行引擎；`scriptRefs` 只是关联脚本清单，不表示自动执行计划。

## 消费快路径

业务项目、流程、接口、数据库、日志、告警和排障类问题默认先走 Playbook。

1. 先确认目标项目仓库 ID；如果用户没给出，先列出项目仓库并请用户确认：

```bash
actiondock repository list --purpose project --json
```

2. 根据项目仓库和关键词搜索候选任务手册：

```bash
actiondock playbook list --repository-id <repositoryId> --enabled --keyword "<text>" --json
```

3. 如果命中专用 Playbook，读取完整详情：

```bash
actiondock playbook get <playbook-id> --json
```

4. 固定按以下顺序消费详情：
   1. 查看 `riskLevel`
   2. 查看 `stopConditions`
   3. 解析项目知识入口
   4. 读取 `knowledgeRefs`
   5. 阅读 `guideMarkdown`
   6. 只有信息足够、风险可接受时才考虑 `scriptRefs`

5. 如果没有专用命中，查找并使用通用项目调查 Playbook：

```bash
actiondock playbook list --keyword "generic-project-investigation" --enabled --json
actiondock playbook get generic-project-investigation --json
```

如果通用 Playbook 尚未安装，也按本文件的“通用项目调查 fallback”执行。

命中任一停止条件时停止，并向用户说明缺少什么或为什么需要人工确认。

给用户总结时，默认说明：命中的 Playbook、风险等级、关联知识数量、关联脚本数量、停止条件和实际参考的项目文档。

## 通用项目调查 fallback

没有专用 Playbook 或 `generic-project-investigation` 未安装时，使用这条最小路线：

1. 确认目标项目仓库 ID。
2. 转到 `references/project-knowledge.md`，执行 `repository resolve` 并读取 `ACTIONDOCK.md`。
3. 严格按 `ACTIONDOCK.md` 给出的入口文件、目录和关键词继续调查。
4. 文档不足、需要确认真实实现或文档与实现疑似不一致时，才搜索源码。
5. 只有知识已经收敛到明确操作或数据需求时，才查看脚本；执行脚本前必须先查询 schema。

停止条件：

- 缺少目标项目仓库 ID
- 未找到 `ACTIONDOCK.md` 或项目知识入口为空
- 需要高风险写操作
- 需要生产数据权限但用户尚未确认
- 无法判断是否应使用专用 Playbook

## 命令选择

### 查候选

```bash
actiondock playbook list --json
actiondock playbook list --repository-id <repositoryId> --tag <tag> --keyword "<text>" --enabled --json
```

- `playbook list --json`：摘要候选列表，是发现主入口。
- `playbook list --json` 不返回 `guideMarkdown`、`knowledgeRefs`、`scriptRefs`、`stopConditions`。
- 不要使用任务手册分组命令；当前 Playbook 模型已经不再使用分组。

### 读详情

```bash
actiondock playbook get <playbook-id> --json
```

- `playbook get --json`：读取单个 Playbook 完整定义，也是消费执行导览的主命令，返回 `riskLevel`、`guideMarkdown`、`knowledgeRefs`、`scriptRefs` 和 `stopConditions`。

## 关联资源使用

### 知识引用

`knowledgeRefs` 只做引用，不内联知识正文，支持两类：

- `NOTE`：针对某个项目仓库的附加阅读指引，正文在 `markdown` 字段。
- `FILE`：项目仓库内相对路径。

如果要继续读取项目内容，转到 `references/project-knowledge.md`：

1. 先执行 `actiondock repository resolve --repository-id <repositoryId> --json`
2. 先读返回的 `ACTIONDOCK.md` 内容
3. 先看该仓库下的 `NOTE`
4. 需要浏览文件时，通过 `actiondock-workspace` 插件访问 `FILE` 指向的项目文件

不要因为本地恰好有同名目录就直接用本地文件命令读取项目仓库；ActionDock 可能运行在远端。

### 关联脚本

执行 `scriptRefs` 关联脚本前先查 schema：

```bash
actiondock script schema <script-id> --json
```

再按 `references/script-execution.md` 的规则执行。以下情况不要继续自动运行脚本：

- 高风险写操作
- 缺少关键上下文
- Playbook 明确要求人工确认

## 作者态维护

查看和维护：

```bash
actiondock playbook create --definition-file ./playbook.json --json
actiondock playbook update <playbook-id> --definition-file ./playbook.json --json
actiondock playbook delete <playbook-id> --json
```

复杂字段只走 `--definition-file`，不要把 `guideMarkdown`、知识引用、脚本引用拆成大量 CLI flags。

Playbook 最小示例：

```json
{
  "id": "refund-failure",
  "name": "退款失败排查",
  "description": "定位退款失败根因并给出下一步建议",
  "tags": ["refund", "payment"],
  "riskLevel": "MEDIUM",
  "repositoryIds": ["billing-service"],
  "knowledgeRefs": [
    { "type": "NOTE", "repositoryId": "billing-service", "markdown": "先看退款链路背景，再读 runbook。" },
    { "type": "FILE", "repositoryId": "billing-service", "path": "docs/runbooks/refund-runbook.md" }
  ],
  "scriptRefs": [
    { "scriptId": "query-log", "purpose": "查询退款链路日志" }
  ],
  "guideMarkdown": "先读取 ACTIONDOCK.md，再查看 refund-runbook.md。",
  "stopConditions": ["缺少关键上下文", "需要高风险写操作", "已确认根因"],
  "enabled": true
}
```

保存 Playbook 时平台会校验：

- `guideMarkdown` 非空
- `scriptRefs.scriptId` 存在
- `NOTE` 的 `markdown` 非空
- `FILE` 的 `path` 必须是仓库内相对路径
