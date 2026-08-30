# AI Agent 接入与集成指南

ActionDock 2.0 导出的核心产物是一个符合业界通用规范的 **Skill 交付包**。

本文档详细介绍如何将导出的 Skill 接入各类主流 AI Agent（如 Antigravity、Claude Code、Cursor、Windsurf、自定义 Agent 框架等），使 Agent 能够无缝发现、阅读并调用 ActionDock 工具。

---

## 方式一：作为 Model Context Protocol (MCP) Server 接入（推荐）

如果您的 AI Agent（如 Claude Code、Cursor、VS Code、Windsurf 等）原生支持 MCP 协议，可以直接将 ActionDock Package 作为 MCP Tool Server 接入：

### 1. STDIO 直连（最简便）
在 MCP 客户端配置文件中添加：

```json
{
  "mcpServers": {
    "github-tools": {
      "command": "bunx",
      "args": ["@actiondock/cli", "mcp", "--dir", "/path/to/my-tools"]
    }
  }
}
```

### 2. HTTP 远程微服务接入
```bash
ac mcp serve --port 5178 --token <secret-token>
```
### 3. 长任务与异步执行 (MCP Tasks Extension)
如果 Agent 需要执行耗时较长的工作流（如多阶段抓取、持续同步等），可直接使用 MCP Tasks 扩展（`execution: { mode: "async" }`），并配合 `tasks/get`、`tasks/cancel` 端点进行追踪与控制。

详见 **[MCP 适配器指南](mcp-integration.md)**。


---

## 方式二：自包含 Skill 交付包接入

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

## 常见 AI Agent 接入方式

### 接入 Antigravity / Google AGY
将导出的 Skill 目录放置在用户或项目的技能目录下：
* 全局路径：`~/.gemini/antigravity-cli/custom/skills/github-tools/`
* 项目路径：`<项目根目录>/.gemini/skills/github-tools/`

Antigravity 会自动读取 `SKILL.md` 顶部的 YAML Frontmatter（`name: github-tools`），在 Agent 启动或任务规划时自动激活此技能，并通过执行 `./bin/github-tools` 完成工具调用。

---

### 接入 Claude Code / Anthropic Agent
将导出的 Skill 目录添加到 Claude Code 的技能配置目录中：
```bash
# 复制到 skills 目录
cp -r dist/github-tools-skill ~/.claude/skills/github-tools
```
Claude Code 会在处理相关提示词时自动阅读 `SKILL.md`，并直接运行其中的独立二进制。

---

### 接入 Cursor / Windsurf / 自定义 LLM Agent
在 Agent 的 System Prompt 或自定义规则文件（如 `.cursorrules`）中引用导出的 Skill：

```markdown
你可以使用 `./dist/github-tools-skill/bin/github-tools` 命令行工具完成 GitHub 相关任务。
详细操作手册与参数说明请参阅 `./dist/github-tools-skill/SKILL.md`。

常用命令：
* 发现工具：`./dist/github-tools-skill/bin/github-tools list --json`
* 查看入参：`./dist/github-tools-skill/bin/github-tools describe <action-id> --json`
* 执行操作：`./dist/github-tools-skill/bin/github-tools run <action-id> --input '{"key": "value"}'`
```

---

## 为什么 ActionDock 交付模式最适合 AI Agent？

* **双模支持（Dual Modes）**：既可以通过标准 **MCP 协议** 与各类现代化 LLM Client 直连，也可以导出为 **零外部依赖独立二进制 + Skill.md** 跨环境直接执行。
* **零安装负担（Zero Dependency Headache）**：二进制模式下无需 `npm install`、`pip install`，无环境配置损坏风险。
* **标准机器协议（Clean JSON Protocol）**：所有的结果数据强制输出在 `stdout`（`{"ok": true, "data": ...}`），日志输出在 `stderr`，Agent 不受日志污染。
* **内置 SOP 引导（Playbook Driven）**：除函数接口外附带 Playbook 业务操作指南，大幅降低 Agent 幻觉与误操作风险。
