# 核心概念：Agent Skill 技能资产

Agent Skill 是面向智能体（如 Claude Code、Cursor、Antigravity、Codex 等）的高级自包含交付资产。

它将原子能力 Action、操作规程 Playbook 与执行载体打包为一个标准的技能目录。

在人制定规程、智能体编写实现的协作模式下，Agent Skill 是最理想的交付载体：它不仅向智能体提供了确定性的可执行能力，更内嵌了人制定的操作时序与安全底线，使智能体能够自主索引规程、安全调用底层工具，告别盲目试错与失控调用。

---

## 交付形态对比

ActionDock 支持两种 Skill 交付形态：

```text
               ┌─ 源码型 Skill（默认模式：--mode source）
               │   • 包含 TypeScript 源码与 actiondock.json 清单
Agent Skill ───┤   • 跨平台体积极小
               │   • 依托宿主环境的 Node.js 运行时与 ActionDock 底座直接执行
               │
               └─ Node.js 目录型 Skill（--mode node）
                   • 输出自包含的 Node.js 可运行交付目录，内嵌统一执行入口
                   • 可通过 --vendor-deps 固化生产依赖，仅依赖宿主安装兼容的 Node.js
```

---

## Skill 目录结构

执行 `ad export skill` 导出的目录结构如下：

### 源码型技能目录结构
```text
dist/github-tools-skill/
├── SKILL.md                 # 面向智能体的标准说明书（含规程索引）
├── actiondock.json          # 声明式清单事实源
├── actions/                 # Action 实现源码
└── playbooks/               # 规程文档
```

### Node.js 目录型技能目录结构
```text
dist/github-tools-node-skill/
├── SKILL.md                 # 指向 Node.js 启动入口的技能说明书
├── actiondock.json          # 声明式清单事实源
├── dist/                    # 编译后的 JavaScript 产物与启动入口
└── node_modules/            # 固化的运行时依赖（启用 --vendor-deps 时）
```

---

## `SKILL.md` 规范

导出的 `SKILL.md` 是智能体发现与调度工具的主要入口：

```markdown
---
name: github-tools
description: GitHub 自动化运维与代码审查工具集，支持 PR 查询、评论与合规合并
---

# GitHub Tools Skill 指南

## 可用 Action 工具清单
- `github.get-pr`: 获取 GitHub PR 详情
- `github.create-comment`: 提交审查评论
- `github.merge-pr`: 执行 PR 合并

## 推荐操作规程
- PR 自动化审查规程：playbooks/review-pr.md

## 调用命令
`ad run <action-id> --input '<json>'`
```

---

## 导出命令集

```bash
# 导出源码型 Skill（默认模式）
ad export skill --out ./dist/github-tools-skill

# 导出 Node.js 目录型自包含 Skill
ad export skill --mode node --out ./dist/github-tools-node-skill

# 导出 Node.js 目录型 Skill 并固化生产依赖
ad export skill --mode node --vendor-deps --out ./dist/github-tools-node-skill

# 按规程按需裁剪导出（仅打包指定 Playbook 及其引用的 Action 依赖闭包）
ad export skill --playbook review-pr --out ./dist/review-pr-skill

# 批量导出多个包为独立技能
ad export skill -P team4u.github-tools team4u.gitlab-tools --out ./dist/skills

# 导出当前工作区内所有子包
ad export skill --workspace --out ./dist/skills

# 复合模式聚合导出为单套件技能
ad export skill -P team4u.github-tools team4u.k8s-ops --bundle devops-suite --out ./dist/devops-suite
```

---

## 使用者消费方式

导出的 Skill 包可直接投递给不同智能体使用：
- 全局安装：执行 `npx skills add team4u/actiondock -g -y` 全局装载。
- Claude Code：放置在 `~/.claude/skills/<skill-name>` 或项目根目录 `.claude/skills/`。
- Antigravity：放置在 `~/.gemini/antigravity-cli/skills/<skill-name>`。
- 通用智能体客户端：解析 `SKILL.md` 注入系统提示词与规程，通过 `ad describe <id>` 动态查验参数契约并调度执行。
