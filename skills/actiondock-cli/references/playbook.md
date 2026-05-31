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
actiondock repository list --purpose project --intent "<regex>" --json
```

2. 根据项目仓库和意图正则搜索候选任务手册：

```bash
actiondock playbook list --repository-id <repositoryId> --enabled --intent "<regex>" --json
```

3. 如果命中专用 Playbook，读取完整详情：

```bash
actiondock playbook get <playbook-id> --json
```

4. 固定按以下顺序消费详情：
   1. 查看 `riskLevel`
   2. 查看 `stopConditions`
   3. 阅读 `guideMarkdown`，提取用户当前问题、任务阶段、业务对象、故障类型和关键词
   4. 根据用户问题、`guideMarkdown` 和 `scriptRefs[].purpose` 选择最小相关脚本集
   5. 只对选中的脚本查询 schema
   6. 用选中脚本 schema 生成待补齐问题清单
   7. 带着问题清单进入项目知识库定向查找答案
   8. 信息足够且风险可接受时，才执行脚本

5. 如果没有命中专用 Playbook，CLI 会自动退回同一过滤条件下的全量摘要列表；仍无法判断时，按本文件的“通用项目调查 fallback”执行。

命中任一停止条件时停止，并向用户说明缺少什么或为什么需要人工确认。

给用户总结时，默认说明：命中的 Playbook、风险等级、选中的脚本、查过的 schema、实际参考的项目文档和仍未补齐的问题。

## 通用项目调查 fallback

没有命中专用 Playbook 时，使用与命中 Playbook 相同的目标驱动流程；区别是用下面这段通用 guide 替代 `guideMarkdown`：

```text
根据用户当前问题定位项目知识、脚本参数和下一步动作。先判断是否需要脚本；需要脚本时，只从脚本摘要中选择与用户问题最相关的脚本。默认 1 个，最多 3 个。先看选中脚本 schema，再用 schema 字段、字段描述、枚举值和用户问题生成知识检索问题清单。只围绕问题清单读取项目知识、文档或源码。
```

最小路线：

1. 确认目标项目仓库 ID。
2. 按用户问题判断是否需要脚本；需要时先列脚本摘要，只选择相关脚本，不批量查 schema。
3. 只对选中的脚本查询 schema。
4. 用用户问题、通用 guide、选中脚本 schema 生成问题清单。
5. 转到 `references/project-knowledge.md`，执行 `repository resolve` 并读取 `ACTIONDOCK.md`，只用它确定入口、目录规则和禁搜目录。
6. 严格围绕问题清单读取项目知识、文档或源码。
7. 信息足够且风险可接受时，才执行脚本。

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
actiondock playbook list --repository-id <repositoryId> --tag <tag> --intent "<regex>" --enabled --json
```

- `playbook list --json`：摘要候选列表，是发现主入口。
- `playbook list --json` 不返回 `guideMarkdown`、`knowledgeRefs`、`scriptRefs`、`stopConditions`。
- `--intent` 是正则意图搜索，匹配摘要字段；未命中时 CLI 自动回退全量候选。

### 读详情

```bash
actiondock playbook get <playbook-id> --json
```

- `playbook get --json`：读取单个 Playbook 完整定义，也是消费执行导览的主命令，返回 `riskLevel`、`guideMarkdown`、`knowledgeRefs`、`scriptRefs` 和 `stopConditions`。

## 关联资源使用

### 脚本选择与 schema

`scriptRefs` 是候选工具池，不是必须全部检查的脚本列表。选择脚本时必须遵守：

- 优先匹配用户当前问题、`guideMarkdown` 的任务阶段、业务对象、故障类型和 `scriptRefs[].purpose`。
- 默认只选 1 个最相关脚本；确有并行路径时最多选 3 个。
- 不相关脚本不查 schema。
- 无法判断哪个脚本相关时，先查项目知识或问用户，不要批量看所有 schema。

只对选中的脚本查 schema：

```bash
actiondock script schema <script-id> --json
```

看 schema 的目的不是执行脚本，而是反推出知识库需要回答什么。维护一个临时问题清单：

```text
任务目标：
- guideMarkdown 或 fallback guide 中要解决的问题

选中脚本：
- scriptId / purpose

schema 需要补齐：
- 字段名
- 字段描述
- 是否 required
- enum / 默认值 / 格式要求
- 可能来源：用户输入 / guideMarkdown / ACTIONDOCK.md / knowledgeRefs / 文档搜索 / 源码确认

搜索关键词：
- 用户问题关键词
- guideMarkdown 关键词
- 选中脚本 purpose
- schema 字段名、字段描述、enum 值
- 业务对象名、接口名、表名、日志关键词、环境名
```

### 知识引用

`knowledgeRefs` 只做引用，不内联知识正文，支持两类：

- `NOTE`：针对某个项目仓库的附加阅读指引，正文在 `markdown` 字段。
- `FILE`：项目仓库内相对路径。

知识引用必须按问题清单定向使用，不要因为存在 `knowledgeRefs` 就全量阅读。进入项目知识时转到 `references/project-knowledge.md`：

1. 先执行 `actiondock repository resolve --repository-id <repositoryId> --json`
2. 读取返回的 `ACTIONDOCK.md`，只用它确定入口、目录规则、推荐文档和禁搜目录
3. 按问题清单读取相关 `NOTE` 和 `FILE`
4. 用问题清单中的关键词通过 `actiondock-workspace` 定向搜索
5. 文档不足、需要确认真实实现或文档与实现疑似不一致时，才查源码

不要因为本地恰好有同名目录就直接用本地文件命令读取项目仓库；ActionDock 可能运行在远端。

### 执行脚本

只有问题清单已经补齐、风险可接受、没有命中停止条件时，才按 `references/script-execution.md` 的规则执行选中脚本。以下情况不要继续自动运行脚本：

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
