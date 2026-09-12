# Playbook 规程编写指南

Playbook 是面向智能体的**标准作业规程**（SOP）。

如果说 Action 决定了智能体「能做什么」，那么 Playbook 规定了智能体「该怎么做、按什么顺序做、遇到错误如何分支、哪些高危操作绝不能做」。在「人定规程，智能体写实现」的协作模式下，Playbook 是人类划定业务边界与安全底线的核心抓手。

---

## 规程的核心价值与设计哲学

在模型调用工具时，仅靠零散的接口描述往往无法保证业务流程合规：

- 模型可能会遗漏必要的前置检查（例如在合并代码前未确认持续集成检查是否全部通过）。
- 在多步骤复合操作中极易出现步骤时序倒错或参数幻觉。
- 缺乏明确的安全红线与阻断规则，容易误触高危逻辑或误删生产数据。

Playbook 将运维手册、业务流程与专家经验沉淀为结构化 Markdown 文件，统一存放在 `playbooks/` 目录下，作为智能体理解任务意图与规避风险的标准指导书。

---

## 清单配置与单一事实源

在 ActionDock 2.0 中，`actiondock.json`（规范版本 `schemaVersion: 2`）是动作与规程清单的唯一事实源。Playbook 的条目在清单中显式登记：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "playbooks": {
    "review-pr": {
      "file": "playbooks/review-pr.md",
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

- `file`：Playbook Markdown 文件的相对路径。
- `description`：规程功能描述与意图匹配提示。
- `actions`：该 Playbook 所依赖或调用的 Action 标识列表（支持当前包动作或 `<package-id>/<action-id>` 跨包完全限定标识符）。

---

## Playbook Markdown 文档编写规范

规程文档存放在项目根目录的 `playbooks/` 文件夹下，采用纯 Markdown 格式。正文用于指导智能体按照规范逻辑执行：

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

在多包依赖体系中，传递依赖包中的内部 Action 默认不对外公开根调用权限。
若某个可见的 Playbook 点名声明了传递包中的 Action，宿主便建立起委托关系，仅允许外部通过该 Playbook 关联规程调用该特定 Action，同时继续隐藏传递包的其他内部 Action，保障依赖封装性。

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
  校验器自动检查清单中的入口文件是否存在、声明引用的 Action 是否存在于当前包或已声明的依赖包中。

---

## 按 Playbook 依赖按需裁剪导出 Skill

在将大型 Action Package 分发为 Skill 资产时，可以通过 `--playbook` 参数仅导出该 Playbook 所需的最小 Action 依赖子集：

```bash
ad export skill --playbook review-pr --out ./dist/review-pr-skill
```

导出引擎会自动分析依赖图，裁剪掉未在 `actions` 依赖闭包中声明的无关文件，生成极简自包含的专属 Skill 资产。
