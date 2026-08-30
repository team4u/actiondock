---
id: review-pr
description: 用于评审 GitHub Pull Request、检查代码变更并自动发表结构化评审意见的标准操作规程 (SOP)
actions:
  - github.list-prs
  - github.get-pr
  - github.review-pr
  - github.comment-pr
---

# Pull Request 自动化评审标准操作规程 (SOP)

本 Playbook 用于指导 AI Agent 使用独立的 `github-tools` 二进制可执行文件完成 GitHub Pull Request 的自动化评审与反馈。

## 任务执行步骤

1. **发现与检查 PR 详情**：
   - 调用 `github.get-pr` 获取目标 PR 的标题、作者、详细描述及代码修改行数等统计数据。
2. **执行自动化代码评审**：
   - 调用 `github.review-pr` 对 PR 进行自动化体检与规范检查（包括 PR 变更规模、描述完整度、WIP 状态标记等）。
   - 检查返回的评审结论（Verdict）与具体改进建议（Findings）。
3. **发表评审意见**：
   - 调用 `github.comment-pr` 将生成的评审摘要与建议发表到 PR 讨论区。
   - **注意**：除非用户明确要求，否则切勿执行自动合并操作。
