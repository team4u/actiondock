# 编写 Playbook 规程

**Playbook（规程）** 是 ActionDock 中面向 AI Agent 的业务操作流程规范。

它向 AI Agent 描述在特定业务场景下，按照什么顺序与边界条件组合调度原子工具。

---

## Playbook 文件规范

Playbook 存放在项目根目录的 `playbooks/` 文件夹下，采用 `.md` Markdown 格式，顶部包含 YAML Frontmatter 元数据：

```markdown
---
id: review-pr
name: PR 审查规程
description: 自动化拉取 GitHub Pull Request、分析差异并提交标准化审查意见
actions:
  - github.get-pr
  - github.create-comment
---

# PR 自动化审查操作规程

## 目标与适用范围
当开发者提出 PR 审查请求时，AI 助手应遵循以下标准作业规程。

## 标准作业流程
- **获取详情**：首先调用 `github.get-pr` 获取 PR 标题、描述与目标分支。
- **分析差异**：若代码修改量超过 500 行，要求用户确认是否分批审查。
- **提交反馈**：调用 `github.create-comment` 提交包含安全漏洞、性能建议与风格检查的结构化评论。

## 安全红线与注意事项
- 严禁在未经人类确认的情况下直接调用 `github.merge-pr` 合并包含敏感变更的 PR。
- 若 API 报错 403 / 401，应提示用户检查 `GITHUB_TOKEN` 权限。
```

---

## Frontmatter 字段说明

| 字段 | 类型 | 是否必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | 是 | Playbook 唯一标识符（如 `review-pr`） |
| `name` | `string` | 是 | 人类与 AI 可读的规程名称 |
| `description` | `string` | 是 | 规程功能描述与意图匹配提示 |
| `actions` | `string[]` | 否 | 该 Playbook 所依赖的 Action ID 列表（支持当前包动作或 `<package-id>/<action-id>` 跨包完全限定标识符） |

---

## 检索与查看 Playbook

ActionDock 支持在项目内或全局任意目录查看已注册的 Playbook：

```bash
# 列表检索 Playbook（支持模糊搜索与 intent 正则匹配）
ad playbook list
ad playbook list -i "review|test"

# 查看 Playbook 详情与完整 SOP 正文（支持自动跨包定位）
ad playbook show review-pr
```

---

## 校验 Playbook

使用 `ad playbook validate` 命令检查 Playbook 文件格式与引用的 Action 是否存在（支持当前项目或全局已链接包）：

```bash
# 校验当前包或全局所有 Playbook（自动支持跨包 Action 解析）
ad playbook validate

# 校验指定 Playbook
ad playbook validate review-pr
```

---

## 按 Playbook 按需裁剪导出 Skill

在将大型 Action Package 分发为 Skill 时，可以通过 `--playbook` 参数仅导出该 Playbook 所需的最小 Action 依赖子集（支持 `-P` 跨目录导出）：

```bash
ad export skill --playbook review-pr --out ./dist/review-pr-skill
```

导出引擎会自动裁剪掉未在 `actions` 列表中声明的无用文件，生成极简自包含的专属 Skill 包。

