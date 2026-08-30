# AI Agent 接入与集成指南

ActionDock 2.0 导出的核心产物是一个符合业界通用规范的 **Skill 交付包**。

本文档详细介绍如何将导出的 Skill 接入各类主流 AI Agent（如 Antigravity、Claude Code、Cursor、OpenCode、自定义 Agent 框架等），使 Agent 能够无缝发现、阅读并调用 ActionDock 工具。

---

## 1. Skill 交付包的标准结构

当您执行 `ac export skill` 后，生成的 Skill 目录包含：

```text
dist/github-tools-skill/
├── SKILL.md                  # 包含标准 YAML Frontmatter 的 Agent 引导手册
├── actiondock.skill.json     # 机器可读的结构化清单（元数据、Action 列表与参数 Schema）
├── playbooks/                # 任务 SOP 规程文件
│   └── review-pr.md
└── bin/
    └── github-tools          # 独立自包含二进制（无需预装 Node/Bun/Python/Java）
```

---

## 2. 常见 AI Agent 接入方式

### 2.1 接入 Antigravity / Google AGY
将导出的 Skill 目录放置在用户或项目的技能目录下：
* 全局路径：`~/.gemini/antigravity-cli/custom/skills/github-tools/`
* 项目路径：`<项目根目录>/.gemini/skills/github-tools/`

Antigravity 会自动读取 `SKILL.md` 顶部的 YAML Frontmatter（`name: github-tools`），在 Agent 启动或任务规划时自动激活此技能，并通过执行 `./bin/github-tools` 完成工具调用。

---

### 2.2 接入 Claude Code / Anthropic Agent
将导出的 Skill 目录添加到 Claude Code 的技能配置目录中：
```bash
# 复制到 skills 目录
cp -r dist/github-tools-skill ~/.claude/skills/github-tools
```
Claude Code 会在处理相关提示词时自动阅读 `SKILL.md`，并直接运行其中的独立二进制。

---

### 2.3 接入 Cursor / Windsurf / 自定义 LLM Agent
在 Agent 的 System Prompt 或自定义规则文件（如 `.cursorrules`）中引用导出的 Skill：

```markdown
你可以使用 `./dist/github-tools-skill/bin/github-tools` 命令行工具完成 GitHub 相关任务。
详细操作手册与参数说明请参阅 `./dist/github-tools-skill/SKILL.md`。

常用命令：
1. 发现工具：`./dist/github-tools-skill/bin/github-tools list --json`
2. 查看入参：`./dist/github-tools-skill/bin/github-tools describe <action-id> --json`
3. 执行操作：`./dist/github-tools-skill/bin/github-tools run <action-id> --input '{"key": "value"}'`
```

---

## 3. 为什么这种交付模式最适合 AI Agent？

1. **零安装负担（Zero Dependency Headache）**：Agent 在沙箱容器或远程服务器中执行任务时，无需执行 `npm install`、`pip install` 或安装复杂的开发环境，直接执行单一二进制文件即可。
2. **标准机器协议（Clean JSON Protocol）**：
   - 所有的结果数据强制输出在 `stdout`，格式统一为 `{"ok": true, "data": ...}`。
   - 所有的日志与调试信息输出在 `stderr`，Agent 不会因为日志污染而导致 JSON 解析失败。
3. **内置 SOP 引导（Playbook Driven）**：除了单纯提供函数 API，Skill 还附带了 Playbook 业务操作手册，指导 Agent 按正确的业务顺序协同工作，大幅降低幻觉与误操作风险。
