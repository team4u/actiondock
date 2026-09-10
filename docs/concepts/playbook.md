# 核心概念：Playbook 规程

Playbook 是面向智能体的**标准作业规程**。

如果说 Action 决定了智能体「能做什么」，那么 Playbook 规定了智能体「该怎么做、按什么顺序做、遇到错误如何分支、哪些高危操作绝不能做」。

在人制定规程、智能体编写实现的协作模式下，人与智能体协作的核心抓手正是 Playbook：人负责制定规则与安全底线，智能体负责执行与实现。

---

## 规程的核心价值

在模型调用工具时，单靠零散的接口描述往往无法保证流程合规：
- 模型可能会遗漏必要的前置检查（如在合并代码前未确认持续集成检查是否全部通过）。
- 在多步骤复合操作中极易出现步骤执行顺序错乱。
- 缺乏明确的安全红线与阻断规则，容易误触高危逻辑或误删数据。

Playbook 将运维手册、业务流程与专家经验沉淀为结构化 Markdown 文件，统一存放在 `playbooks/` 目录下，作为智能体理解任务意图与规避风险的标准指导书。

---

## 清单配置与文件结构

在 ActionDock 2.0 中，`actiondock.json` 是元数据的唯一事实源。Playbook 的条目在清单中显式登记：

```json
{
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "playbooks": {
    "review-pr": {
      "entry": "playbooks/review-pr.md",
      "description": "PR 自动化审查规程与红线检查",
      "actions": [
        "github.get-pr",
        "github.create-comment",
        "github.merge-pr"
      ]
    }
  }
}
```

Playbook Markdown 文件正文结构如下：

```markdown
# PR 自动化审查规程

## 前置条件检查
- 检查 PR 状态是否为 open。若为 closed 或 draft，终止流程并记录原因。
- 检查 PR 是否包含针对核心安全配置的修改。

## 审查与评论
- 调用 github.get-pr 获取文件变更列表。
- 针对每一项缺陷调用 github.create-comment 提交行内评论。

## 合并与终态
- 仅当全部持续集成检查通过且评审打分达标时，方可调用 github.merge-pr。

## 安全红线
- 绝对禁止在未通过持续集成验证的情况下执行合并。
- 绝对禁止在涉及删除数据库脚本的 PR 上直接审批通过。
```

---

## 传递依赖能力委托

在多包依赖体系中，传递依赖包中的内部 Action 默认不对外公开根调用权限。
若某个可见的 Playbook 点名声明了传递包中的 Action，宿主便建立起委托关系，仅允许外部通过该 Playbook 关联规程调用该特定 Action，同时继续隐藏传递包的其他内部 Action，保障依赖封装性。

---

## 规程语法与完整性校验

ActionDock 提供了专用的规程校验命令：

```bash
# 校验当前包的所有规程
ad playbook validate

# 校验单个规程
ad playbook validate review-pr
```

校验器执行以下检查：
- 清单中的入口文件是否存在且路径合法。
- 声明引用的 Action 是否存在于当前包或已声明的依赖包中。
- 规程引用的 Markdown 语法是否符合规范。
