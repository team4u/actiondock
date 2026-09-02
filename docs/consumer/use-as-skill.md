# 接入 Claude Code / Antigravity 技能库

ActionDock 导出的 Agent Skill（通过 `ac export skill` 生成）是一个包含 `SKILL.md`、`actiondock.skill.json`、`actions/` 与 `playbooks/` 的自包含技能包。

AI Agent（如 Claude Code、Antigravity、Codex 等）可以直接识别该目录，并在识别到任务意图时，自主按规程调度执行。

---

## 快速导出官方示例为 Skill

克隆官方仓库并在根目录执行 `ac link` 后，可在任意路径通过包名直接导出 Skill：

```bash
# 导出为源码型 Skill（Agent 宿主环境需有 Bun 运行环境）
ac export skill -P team4u.github-tools --out ~/.claude/skills/github-tools

# 导出为独立单文件 Skill（内嵌二进制，宿主环境零依赖）
ac export skill -P team4u.github-tools --standalone --out ~/.claude/skills/github-tools
```

> **提示**：也可以进入示例目录直接导出：
> ```bash
> cd examples/github-tools
> ac export skill --out ~/.claude/skills/github-tools
> ```

---

## 在 Claude Code 中装载与使用

Claude Code 原生支持基于文件系统的 Skill 自动发现机制。

### 全局生效（推荐，所有项目均可使用）
将导出的 Skill 放入用户技能目录 `~/.claude/skills/<skill-name>`：

```bash
ac export skill -P team4u.github-tools --out ~/.claude/skills/github-tools
```

### 仅对当前项目生效
将 Skill 目录放置在目标项目的 `.claude/skills/` 下：

```bash
mkdir -p .claude/skills
ac export skill -P team4u.github-tools --out .claude/skills/github-tools
```

### 验证与智能体自主调用
启动或重启 Claude Code：
```bash
claude
```
在 Claude 对话中，Claude Code 会自动加载 `SKILL.md` 中的能力定义与规程。当你向模型提问：“*帮我审查 PR #101 并根据规则提出反馈*” 时，模型会自动识别意图并调度 `github.get-pr`、`github.review-pr` 完成任务。

---

## 在 Antigravity / Agent CLI 中装载 Skill

Antigravity CLI 支持全局与工作区双层技能发现：

- **全局技能路径**：`~/.gemini/antigravity-cli/skills/<skill-name>`
- **工作区技能路径**：`<workspace-root>/.gemini/skills/<skill-name>`

```bash
# 导出至 Antigravity 全局技能库
ac export skill -P team4u.github-tools --out ~/.gemini/antigravity-cli/skills/github-tools
```

---

## 目标机器无 Bun 环境时使用独立二进制 Skill

如果消费者的机器、容器或沙箱中未安装 Bun / Node.js 运行时：
1. 导出时加上 `--standalone` 参数：
   ```bash
   ac export skill -P team4u.github-tools --standalone --out ~/.claude/skills/github-tools
   ```
2. 导出的 Skill 会在 `./bin/` 目录下内嵌平台自包含的可执行文件（如 `./bin/github-tools`）。
3. Agent 读取 `SKILL.md` 后，会自动通过 `./bin/github-tools run <action>` 执行，宿主机器无需安装任何运行时即可开箱即用。

---

## 接入自研 Agent 系统或 LangChain / LlamaIndex

自研智能体或使用 LangChain / LlamaIndex / AutoGen 时：

- **自动注册工具函数**：读取 Skill 根目录下的 `actiondock.skill.json`，将其中的 `actions` 字段（包含输入输出 JSON Schema）转换为大模型的 Tool Definition。
- **规程注入系统提示词**：将 `SKILL.md` 和 `playbooks/*.md` 文本注入为 System Prompt 或 RAG 检索知识库，使模型遵循领域专家的作业规程。
