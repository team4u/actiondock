# 核心概念：Agent Skill 交付物

**Agent Skill** 是面向 AI 编程助手（如 Claude Code、Cursor、Antigravity、Codex 等）的最高级自包含交付产物。

它将原子能力（Actions）、操作规程（Playbooks）与执行载体（源码或独立二进制）打包为一个标准的 Skill 目录。

---

## 交付形态对比

ActionDock 支持两种 Skill 交付形态：

```text
               ┌─ 源码型 Skill
               │   • 包含 TypeScript 源码与 actiondock.json
Agent Skill ───┤   • 跨平台体积极小 (< 100KB)
               │   • 依赖宿主环境已安装 Bun
               │
               └─ 独立二进制型 Skill
                   • 内置已编译的零依赖单文件可执行文件
                   • 零外部环境依赖，开箱即用
```

---

## Skill 目录结构

执行 `ac export skill` 导出的目录结构如下：

```text
dist/github-tools-skill/
├── SKILL.md                 # 面向 AI 助手的标准说明书（含 YAML Frontmatter 与规程索引）
├── actiondock.skill.json    # 机器可读的 Skill 清单（包含 Action 列表与参数 Schema）
├── actiondock.json          # 包配置定义
├── actions/                 # Action 实现文件（源码型）
├── playbooks/               # 规程文件
└── bin/                     # 预编译二进制文件（独立型）
    └── github-tools
```

---

## `SKILL.md` 规范

导出的 `SKILL.md` 是 AI Agent 发现与调用工具的主要入口：

```markdown
---
name: github-tools
description: GitHub 自动化运维与代码评审工具集，支持 PR 查询、评论与合规合并
---

# GitHub Tools Skill 指南

## 可用 Action 工具清单
- `github.get-pr`: 获取 GitHub PR 详情
- `github.create-comment`: 提交 Review 评论
- `github.merge-pr`: 执行 PR 合并

## 推荐操作规程
- [PR 自动化审查规程](playbooks/review-pr.md)

## 调用命令
`ac run <action-id> --input '<json>'`
```

---

## 导出命令

```bash
# 导出源码型 Skill
ac export skill --out ./dist/github-tools-skill

# 导出独立二进制型 Skill
ac export skill --standalone --out ./dist/github-tools-skill

# 按需按 Playbook 裁剪导出（仅导出该 Playbook 引用的 Action）
ac export skill --playbook review-pr
```

---

## 使用者消费方式

智能体生态可通过 `npx skills` 直接从 GitHub 安装技能，导出的 Skill 包也可以直接投递给不同 AI 智能体使用：
- **快速安装**：执行 `npx skills add team4u/actiondock -y` 直接装载。
- **Claude Code**：放置在 `~/.claude/skills/<skill-name>` 或项目根目录 `.claude/skills/`
- **Antigravity**：放置在 `~/.gemini/antigravity-cli/skills/<skill-name>`
- **自研 Agent 框架**：解析 `actiondock.skill.json` 注册工具，将 `SKILL.md` 注入为系统提示词与规程。

详细使用方法请查阅 [使用者指南：Agent Skill 使用指南](../consumer/use-as-skill.md) 与 [开发者指南：构建、打包与 Skill 导出](../developer/build-and-export.md)。
