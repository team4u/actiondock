# 任务手册（Playbook）

任务手册是 ActionDock 平台内的任务导览资产。中文 UI 使用“任务手册”，CLI、API 和代码里统一使用 `playbook`。

Playbook 只回答：

- 这是什么任务
- 建议先看哪些知识
- 建议用哪些脚本
- 建议怎么走
- 什么时候别继续

Playbook 不是步骤 DSL，也不是执行引擎。不要把推荐脚本理解为自动执行计划。

## 消费工作流

当用户给出任务意图，优先用 `resolve` 找候选：

```bash
actiondock playbook resolve --intent "<text>" --json
```

如果任务绑定具体项目仓库，带上 `repositoryId`：

```bash
actiondock playbook resolve --intent "<text>" --repository-id <repositoryId> --json
```

### 意图匹配与搜索技巧 (AI 消费指引)

用户的任务意图（`--intent`）在系统底层支持**正则表达式（Case-Insensitive Regex）**匹配。匹配字段包括：任务手册名称、别名（`intentAliases`）、描述、标签，以及分组名称和标签。

由于用户的输入通常是一段复杂的自然语言，而系统底层的任务手册定义（如别名）非常精炼，**消费端 AI Agent 必须对用户意图进行预处理**，避免直接传入原始长句：

1. **提取核心关键字**：将自然语言转化为核心的动词、名词（如将“昨天退款超时了，怎么排查”转化为“退款|超时”）。
2. **使用正则或表达式**：使用正则表达式来实现模糊和多条件搜索。
   - 单关键字搜索：`actiondock playbook resolve --intent "退款" --json`
   - 多关键字逻辑或（OR）：`actiondock playbook resolve --intent "退款|refund|timeout" --json`
   - 顺序关联匹配：`actiondock playbook resolve --intent "退款.*失败" --json`
3. **分次尝试**：如果第一次精确正则匹配不到，应尝试退化到更宽泛的关键字（如从“退款.*失败”退化到“退款”）重新搜索，以获取最多的候选建议。

从候选中选择最合适的 `playbook.id` 后读取 Guide：

```bash
actiondock playbook guide <playbook-id> --json
```

处理顺序固定为：

1. 查看 `riskLevel` 和 `stopConditions`，确认是否允许继续。
2. 读取 `knowledgeRefs` 指向的知识。
3. 按 `guideMarkdown` 判断下一步。
4. 只有在信息足够、风险可接受时才考虑运行 `scriptRefs` 推荐脚本。
5. 命中任一停止条件时停止，并向用户说明缺少什么或为什么需要人工确认。

给用户总结时，说明匹配到的 Playbook、风险等级、推荐知识数量、推荐脚本数量和停止条件。

## 知识引用

`knowledgeRefs` 只做引用，不内联知识正文。

支持两类：

- `ENTRY`: 项目知识入口，`path` 固定为 `ACTIONDOCK.md`
- `FILE`: 项目仓库内相对路径

如果需要读取项目内容，继续遵守 `references/project-knowledge.md`：

1. 先执行 `actiondock repository resolve --repository-id <repositoryId> --json`
2. 先读返回的 `ACTIONDOCK.md` 内容
3. 需要浏览文件时，通过 `actiondock-workspace` 插件访问项目文件

不要因为本地恰好有同名目录就直接用本地文件命令读取项目仓库；ActionDock 可能运行在远端。

## 推荐脚本

`scriptRefs` 只是推荐脚本清单，不复制脚本 schema，也不表示自动执行。

执行脚本前先查 schema：

```bash
actiondock script schema <script-id> --json
```

再按 `references/script-execution.md` 的规则执行。高风险写操作、缺少关键上下文、Guide 明确要求人工确认时，不要继续自动运行脚本。

## 常用命令

查看任务手册：

```bash
actiondock playbook list --json
actiondock playbook list --group <groupId> --repository-id <repositoryId> --tag <tag> --enabled --json
actiondock playbook get <playbook-id> --json
actiondock playbook guide <playbook-id> --json
```

解析任务意图：

```bash
actiondock playbook resolve --intent "<text>" --json
actiondock playbook resolve --intent "<text>" --repository-id <repositoryId> --json
```

作者态维护：

```bash
actiondock playbook create --definition-file ./playbook.json --json
actiondock playbook update <playbook-id> --definition-file ./playbook.json --json
actiondock playbook delete <playbook-id> --json
```

任务分组：

```bash
actiondock playbook-group list --json
actiondock playbook-group get <group-id> --json
actiondock playbook-group create --definition-file ./group.json --json
actiondock playbook-group update <group-id> --definition-file ./group.json --json
actiondock playbook-group delete <group-id> --json
```

复杂字段只走 `--definition-file`，不要把 `guideMarkdown`、知识引用、脚本引用拆成大量 CLI flags。

## Definition 文件形状

Group 最小示例：

```json
{
  "id": "billing-diagnosis",
  "name": "Billing 诊断",
  "description": "billing 项目的排障任务目录",
  "tags": ["billing", "diagnosis"],
  "defaultRepositoryIds": ["billing-service"],
  "enabled": true
}
```

Playbook 最小示例：

```json
{
  "id": "refund-failure",
  "groupId": "billing-diagnosis",
  "name": "退款失败排查",
  "description": "定位退款失败根因并给出下一步建议",
  "intentAliases": ["退款失败", "refund failed", "退款超时"],
  "tags": ["refund", "payment"],
  "riskLevel": "MEDIUM",
  "repositoryIds": ["billing-service"],
  "knowledgeRefs": [
    { "type": "ENTRY", "repositoryId": "billing-service", "path": "ACTIONDOCK.md" },
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

- `groupId` 存在
- `guideMarkdown` 非空
- `scriptRefs.scriptId` 存在
- `ENTRY` 的 `path` 必须是 `ACTIONDOCK.md`
- `FILE` 的 `path` 必须是仓库内相对路径

## 能力包关系

Playbook / PlaybookGroup 可以随能力包分发。

能力包安装出的资产会标记为 `managed=true`，平台内只读。遇到 managed 资产时，不要尝试直接 `update` 或 `delete`；应通过能力包升级或卸载处理。

发布能力包时，如果用户明确要求包含任务手册，需要把相关 `playbookGroupIds` 和 `playbookIds` 纳入发布请求或发布页选择。选择 Playbook 时，其所属 Group 也应包含在发布资产中。
