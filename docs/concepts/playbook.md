# 核心概念：Playbook SOP 规程

**Playbook** 是面向 AI Agent 的**标准作业程序（Standard Operating Procedure, SOP）**。

如果说 Action 决定了智能体「能做什么」，那么 Playbook 规定了智能体「该怎么做、按什么顺序做、遇到错误如何分支、哪些高危操作绝不能做」。

---

## 为什么需要 Playbook？

在大模型调用工具时，单靠零散的 Tool Description 往往无法保证流程合规：
- 大模型可能会遗漏必要的前置检查（如在合并代码前没有检查 CI 状态）。
- 在多步骤操作中可能出现步骤顺序错乱。
- 缺乏明确的安全红线，可能误删生产数据。

Playbook 将人类专家的运维手册与业务规则结构化为 Markdown 文件，存放在 `playbooks/` 目录下。

---

## Playbook 文件结构

每个 Playbook 包含 **YAML Frontmatter 元数据** 与 **结构化 Markdown 正文**：

```markdown
---
id: review-pr
name: PR 自动化审查规程
description: 审查 GitHub Pull Request 的标准操作规程与红线检查
actions:
  - github.get-pr
  - github.create-comment
  - github.merge-pr
---

# PR 自动化审查规程

## 1. 前置条件检查
- 检查 PR 状态是否为 `open`。若为 `closed` 或 `draft`，终止流程并记录原因。
- 检查 PR 是否包含针对核心安全配置的修改。

## 2. 审查与评论
- 调用 `github.get-pr` 获取文件变更列表。
- 针对每一项缺陷调用 `github.create-comment` 提交行内评论。

## 3. 合并与终态
- 仅当全部 CI 检查通过且评审打分 >= 80 时，方可调用 `github.merge-pr`。

## 4. 安全红线 (Guardrails)
- ⚠️ 绝对禁止在未通过 CI 验证的情况下执行合并。
- ⚠️ 绝对禁止在涉及删除生产数据库脚本的 PR 上直接通过。
```

---

## Playbook 语法校验

ActionDock CLI 提供了专用的校验命令：

```bash
# 校验当前包的所有 Playbook
ac playbook validate

# 校验单个 Playbook
ac playbook validate playbooks/review-pr.md
```

校验器会检查：
1. YAML Frontmatter 是否包含 `id`、`name`、`description` 与 `actions` 字段。
2. 声明引用的 `actions` 是否全部存在于当前包或注册表中。
3. Markdown 语法是否符合规范。
