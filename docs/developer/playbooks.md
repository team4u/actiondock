# Playbook 规程编写指南

Playbook 是面向智能体的标准作业规程。
Action 规定智能体能执行的操作。
Playbook 规定智能体执行步骤、分支策略与禁忌操作。
Playbook 是划定业务边界与安全底线的规程。

---

## 规程的核心价值与设计哲学

在模型调用工具时，仅靠零散的接口描述无法保证流程合规：

- 模型可能会遗漏必要的前置校验（例如合并代码前未确认持续集成校验通过）。
- 在多步骤操作中可能出现步骤倒错或参数幻觉。
- 缺乏明确的安全红线，可能误触高危逻辑或删除数据。

Playbook 将业务流程与经验整理为 Markdown 文件。
文件统一存放在 `playbooks/` 目录下。
规程作为智能体理解任务意图与规避风险的指导书。

---

## 清单配置与单一事实源

在 ActionDock 2.x 中，`actiondock.json` 是清单的唯一事实源。
Playbook 条目在清单中登记：

```json
{
  "$schema": "https://actiondock.dev/schema/v2.json",
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "playbooks": {
    "review-pr": {
      "entry": "playbooks/review-pr.md",
      "description": "自动化拉取 GitHub Pull Request、分析差异并提交标准化审查意见",
      "actions": [
        "github.get-pr",
        "github.create-comment"
      ]
    }
  }
}
```

配置属性说明：

- `entry`：Playbook Markdown 文件的相对路径。
- `description`：规程功能描述与意图匹配提示。
- `actions`：该 Playbook 所依赖或调用的 Action 标识列表（支持当前包动作或跨包完全限定标识符）。

---

## Playbook Markdown 文档编写规范

规程文档存放在 `playbooks/` 目录下，采用 Markdown 格式。
正文严禁编写 YAML Frontmatter。
所有元数据统一在 `actiondock.json` 中配置。
正文用于指导智能体按规范逻辑执行：

```markdown
# PR 自动化审查操作规程

## 目标与适用范围
当开发者提出 PR 审查请求时，AI 助手应遵循以下标准作业规程。

## 前置条件检查
- 检查 PR 状态是否为 open。若为 closed 或 draft，终止流程并记录原因。
- 检查 PR 是否包含针对核心安全配置的修改。

## 标准作业流程
- 获取详情：首先调用 github.get-pr 获取 PR 标题、描述与目标分支。
- 分析差异：若代码修改量超过 500 行，要求用户确认是否分批审查。
- 提交反馈：调用 github.create-comment 提交包含安全漏洞、性能建议与风格检查的结构化评论。

## 安全红线与注意事项
- 严禁在未经人类确认的情况下直接调用 github.merge-pr 合并包含敏感变更的 PR。
- 严禁在涉及删除数据库脚本的 PR 上直接审批通过。
- 若 API 报错 403 或 401，应提示用户检查 GITHUB_TOKEN 权限。
```

---

## 传递依赖能力委托

在多包依赖体系中，传递依赖包中的内部 Action 默认不对外公开。
若可见的 Playbook 显式声明了传递包中的 Action，宿主形成委托关系。
外部仅可通过该规程调用该 Action。
宿主继续隐藏其他内部 Action，保障封装性。

---

## 检索与校验 Playbook

ActionDock 提供专用命令用于查看与校验 Playbook：

- 列表检索 Playbook：
  ```bash
  ad playbook list
  ad playbook list -i "review|test"
  ```

- 查看 Playbook 详情与完整正文：
  ```bash
  ad playbook show review-pr
  ```

- 静态语法与引用校验：
  ```bash
  ad playbook validate
  ad playbook validate review-pr
  ```
  校验器校验清单中的入口文件是否存在。
  校验器校验声明引用的 Action 是否存在于当前包或依赖包中。

---

## 按 Playbook 依赖按需裁剪导出 Skill

分发大型 Action Package 为 Skill 资产时，可通过 `--playbook` 导出最小依赖子集：

```bash
ad export skill --playbook review-pr --out ./dist/review-pr-skill
```

导出引擎分析依赖图，裁剪未在 `actions` 闭包中声明的文件。
工具链导出自包含的专属 Skill 资产。
