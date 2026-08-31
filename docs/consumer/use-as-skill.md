# 接入 Claude Code / Antigravity (Agent Skill)

ActionDock 导出的 Agent Skill（通过 `ac export skill` 生成）是一个包含 `SKILL.md`、`actiondock.skill.json`、`actions/` 与 `playbooks/` 的自包含技能包。

AI Agent（如 Claude Code、Antigravity、Codex 等）可以直接识别该目录，并在识别到任务意图时，自主按 SOP 规程调度执行。

---

## 1. 在 Claude Code 中装载 Skill

Claude Code 原生支持基于文件系统的 Skill 自动发现机制。

### 方案 A：全局生效（推荐，所有项目可用）
将 Skill 目录放入当前用户的技能存储路径 `~/.claude/skills/<skill-name>`：

```bash
# 如果是在 ActionDock 项目源码中导出：
ac export skill --out ~/.claude/skills/github-tools

# 如果是从 Git 仓库直接下载/拷贝了导出的 Skill 目录：
cp -r /path/to/downloaded-skill ~/.claude/skills/github-tools
```

### 方案 B：仅对当前工作区生效
将 Skill 目录放置在目标项目的根目录下：

```bash
# 复制到当前项目的 .claude/skills/ 目录下
mkdir -p .claude/skills
cp -r /path/to/downloaded-skill .claude/skills/github-tools
```

### 验证与生效
启动或重启 Claude Code：
```bash
claude
```
在 Claude 对话中，Claude Code 会自动加载 `~/.claude/skills/github-tools/SKILL.md`。当你向它发出类似 *"帮我查询一下 team4u/actiondock 的 PR #1 并按规程审查"* 的指令时，模型会自动调用该 Skill。

---

## 2. 在 Antigravity / Agent CLI 中装载 Skill

Antigravity CLI 支持全局与工作区双层技能发现：

- **全局技能路径**：`~/.gemini/antigravity-cli/skills/<skill-name>`
- **工作区技能路径**：`<workspace-root>/.gemini/skills/<skill-name>`

```bash
# 部署至全局技能库
cp -r /path/to/downloaded-skill ~/.gemini/antigravity-cli/skills/github-tools
```

---

## 3. 目标机器没有 Bun 环境？使用独立二进制型 Skill

如果使用者的机器、容器或沙箱中**没有安装 Bun / Node.js 运行时**：
- 请确保获得的是带有 `--standalone` 编译的独立二进制 Skill 包。
- 该 Skill 包的 `./bin/` 目录下内嵌了平台自包含的可执行文件（如 `./bin/github-tools`）。
- Agent 读取 `SKILL.md` 后，会自动通过 `./bin/github-tools run <action>` 执行，**宿主机器无需安装任何 Runtime 即可开箱即用**。

---

## 4. 接入自研 Agent 系统或 LangChain / LlamaIndex

如果你在自研智能体或使用 LangChain / LlamaIndex / AutoGen：

1. **自动注册 Tool Functions**：
   读取 Skill 根目录下的 `actiondock.skill.json`，将其中的 `actions` 字段（包含输入输出 JSON Schema）直接转换为 LLM 的 Tool Definition。
2. **SOP 注入系统提示词**：
   将 `SKILL.md` 和 `playbooks/*.md` 文本直接注入为 System Prompt 或 RAG 检索知识库，使模型严格遵循专家的业务操作顺序。
