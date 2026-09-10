# Agent Skill 使用指南

ActionDock 是专为 AI 智能体打造的原子能力与操作规程底座。
通过将强类型原子能力 Action 与领域操作规程 Playbook 深度结合，ActionDock 交付标准化、自包含的 Agent Skill 资产。
智能体在面对复合业务任务时，能够自主检索能力定义、遵循标准操作规程，并通过统一命令行接口确定性地调用底层能力。

---

## 核心机制：底座为智能体提供了什么

传统的脚本或黑盒接口往往缺乏模式校验、上下文规程与结构化反馈，导致智能体容易产生幻觉、参数错误或乱序执行。
ActionDock 规范化了面向智能体的完整资产体系：

- 标准入口说明书：`SKILL.md` 包含描述元数据与规程索引，供智能体在系统提示词中自动匹配意图并激活。
- 参数契约按需查验：通过 `ad describe <id>` 动态查验各 Action 的输入输出模式与描述，消除静态文件冗余。
- 领域操作规程：`playbooks/` 目录下提供经过验证的标准作业规程，明确告知智能体步骤时序、前后置条件与安全拦截红线。
- 双模执行载体：
  - 源码型 Skill：跨平台文件体积精简，依托宿主 Node.js 运行时底座与 ActionDock 命令行工具直接执行。
  - Node.js 目录型 Skill：输出自包含的 Node.js 交付目录，内嵌统一入口脚本，可通过 `--vendor-deps` 固化生产依赖。

```text
               ┌─ SKILL.md                 # 智能体技能说明与规程索引
               ├─ playbooks/               # 领域标准操作规程
Agent Skill ───┼─ actions/                 # 源码型原子能力实现
               └─ dist/ 或 node_modules/   # Node.js 目录型编译产物与固化依赖
```

---

## 极速安装：从 GitHub 安装技能

智能体生态支持通过技能管理工具直接从 GitHub 开源仓库发现、安装与管理技能。

### 安装官方技能

无需预先克隆代码或手动构建，直接在终端执行：

```bash
# 全局安装 ActionDock 官方技能（供系统内所有智能体使用）
npx skills add team4u/actiondock -g -y
```

### 从指定 GitHub 仓库安装技能

```bash
# 全局安装指定 GitHub 仓库中的技能包
npx skills add <owner/repo> -g -y

# 全局安装仓库内的指定子技能
npx skills add <owner/repo> -s <skill-name> -g -y
```

### 常用安装参数

- 全局生效安装：添加 `-g` 或 `--global`，安装至当前用户全局目录，供系统内所有智能体复用。
- 指定智能体客户端：使用 `-a` 或 `--agent` 指定安装目标（如 Claude Code、Cursor 等）。
- 自动确认与非交互模式：推荐添加 `-y` 或 `--yes`，自动跳过终端多选与确认提示，适用于脚本自动化拉取或智能体自治安装。
- 独立拷贝文件：添加 `--copy` 强制复制技能目录而非创建符号链接。
- 仅在当前项目生效：省略 `-g` 参数时，默认安装至当前项目根目录的技能文件夹，仅对当前工作区有效。

### 技能管理与维护

```bash
# 查看当前工作区已安装的技能
npx skills list

# 查看用户全局安装的技能
npx skills list -g

# 检查并升级已安装技能至最新版本
npx skills update

# 移除指定技能
npx skills remove <skill-name>
```

---

## 本地导出与私有分发

开发团队可在本地通过 ActionDock CLI 将自研能力导出并分发为 Skill。

### 导出为源码型 Skill

适用于宿主环境具备 Node.js 及 ActionDock 工具链的智能体环境：

```bash
# 从本地已注册的 Action Package 导出
ad export skill -P team4u.github-tools --out ~/.claude/skills/github-tools

# 或在 Action Package 根目录就地导出
cd examples/github-tools
ad export skill --out ~/.claude/skills/github-tools
```

### 导出为 Node.js 目录型 Skill

适用于希望交付自包含目录并在目标宿主仅运行 Node.js 的环境：

```bash
ad export skill -P team4u.github-tools --mode node --vendor-deps --out ./dist/github-tools-skill
```

### 按规程按需精简裁剪

当底层工具包庞大，而特定业务仅需部分能力时，可通过指定 Playbook 导出精简版 Skill，减少智能体上下文干扰：

```bash
ad export skill -P team4u.github-tools --playbook review-pr --out ~/.claude/skills/review-pr
```

---

## 主流智能体客户端装载路径

不同智能体客户端在启动时会自动扫描特定目录下的 Skill 并注入模型上下文。

### Claude Code

Claude Code 支持文件系统技能发现：
- 用户全局生效：`~/.claude/skills/<skill-name>`
- 当前项目生效：`<project-root>/.claude/skills/<skill-name>`

### Cursor 与 Windsurf

Cursor 与 Windsurf 提供双轨支持：
- 技能文件目录：`<project-root>/.cursor/skills/<skill-name>`
- MCP 协议挂载：在 `mcp.json` 中配置 ActionDock 服务（`ad mcp --all`），将所有已注册能力转化为原生工具接口。

### Antigravity 与 Gemini CLI

Antigravity 支持工作区与全局双层发现机制：
- 用户全局生效：`~/.gemini/antigravity-cli/skills/<skill-name>`
- 工作区生效：`<workspace-root>/.gemini/skills/<skill-name>`

### 通用智能体系统与 SDK 集成

对于基于自研引擎的智能体系统：
- 系统提示词注入：将 `SKILL.md` 与目标 Playbook 文本直接注入为系统提示词或知识库，使模型严谨遵循标准操作规程。
- 参数契约按需获取：通过执行 `ad describe <id> --json` 实时获取特定 Action 的输入输出结构，精准对接模型的函数调用体系。

---

## 智能体调度与执行生命周期

智能体使用 ActionDock Skill 时，遵循规范的执行流程：

```text
意图匹配 (SKILL.md) ──► Playbook 规程决议 ──► 执行调用 (ad run)
                                                       │
                                                       ▼
状态持久化 (ctx.state) ◄── 结果校验 (JSON 信封) ◄──────┘
```

### 意图匹配与技能激活

当用户发起自然语言提问（如：“帮我审查当前仓库的 PR 并提交代码评审意见”），智能体根据系统提示词中已载入的 `SKILL.md` 描述和元数据，判定该任务匹配当前 Skill 并激活相应上下文。

### 规程优先决议准则

智能体在调度底层能力前，必须严格遵循**规程优先准则**：
- 优先遵循规程：激活技能后，智能体必须首先检查是否存在匹配当前场景的 Playbook。若存在规程，必须执行 `ad playbook show <id>` 读取规程内容，严格按照规程界定的操作时序、依赖条件与安全红线推进。
- 严禁无序拼凑：严禁在规程存在的情况下，跳过规程直接猜测或无序调用底层 Action。
- 单点降级调用：仅当无匹配规程或用户明确指示执行单点原子操作时，方可直接调用单一 Action。
