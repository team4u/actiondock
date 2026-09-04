# Agent Skill 使用指南

ActionDock 是专为 AI 智能体打造的原子能力与操作规程底座。
通过将强类型原子能力（Action）与领域操作规程（Playbook）深度结合，ActionDock 交付标准化、自包含的 Agent Skill 资产。
智能体在面对复合业务任务时，能够自主检索能力定义、遵循标准操作规程，并通过统一命令行接口确定性地调用底层能力。

---

## 核心机制：底座为智能体提供了什么

传统的脚本或黑盒接口往往缺乏 Schema 校验、上下文规程与结构化反馈，导致智能体容易产生幻觉、参数错误或乱序执行。
ActionDock 规范化了面向智能体的完整交付物体系：

- **标准入口说明书**：`SKILL.md` 包含 YAML 描述元数据与规程索引，供智能体在系统提示词中自动匹配意图并激活。
- **机器可读契约**：`actiondock.skill.json` 包含各 Action 的输入输出 JSON Schema 约束，确保参数校验确定性。
- **领域操作规程**：`playbooks/` 目录下提供经过验证的标准作业规程，明确告知智能体步骤时序、前后置条件与安全拦截红线。
- **双模执行载体**：
  - **源码型 Skill**：跨平台文件体积精简（通常小于 100KB），基于宿主 Bun 运行时执行原生 TypeScript 代码。
  - **独立二进制型 Skill**：内嵌单文件自包含二进制（位于 `./bin/` 目录），执行环境无需安装 Node.js、Bun 或任何外部依赖，开箱即用。

```text
               ┌─ SKILL.md                 # 智能体技能说明与规程索引
               ├─ actiondock.skill.json    # 机器可读参数契约 Schema
Agent Skill ───┼─ playbooks/               # 领域专家标准操作规程
               ├─ actions/                 # 源码型原子能力实现 (TypeScript)
               └─ bin/                     # 独立型自包含二进制程序
```

---

## 极速安装：使用 npx skills 从 GitHub 安装技能

现代智能体生态广泛支持通过 `npx skills` 工具直接从 GitHub 开源仓库发现、安装与管理技能。

### 一键安装官方技能

无需预先克隆代码或手动构建，直接在终端执行（默认附带 `-g` 全局安装与 `-y` 自动确认参数，无需手动介入交互）：

```bash
# 全局安装 ActionDock 官方技能（供系统内所有智能体使用）
npx skills add team4u/actiondock -g -y
```

### 从任意 GitHub 仓库安装技能

```bash
# 全局安装指定 GitHub 仓库中的技能包
npx skills add <owner/repo> -g -y

# 全局安装仓库内的指定子技能
npx skills add <owner/repo> -s <skill-name> -g -y
```

### 常用安装参数

- **全局生效安装**：
  添加 `-g` 或 `--global`，安装至当前用户全局目录，供系统内所有智能体复用：
  ```bash
  npx skills add team4u/actiondock -g -y
  ```
- **指定智能体客户端**：
  使用 `-a` 或 `--agent` 指定安装目标（如 Claude Code、Cursor 等）：
  ```bash
  npx skills add team4u/actiondock -g -a claude-code cursor -y
  ```
- **自动确认与非交互模式**：
  默认推荐添加 `-y` 或 `--yes`，自动跳过终端多选与确认提示，适用于脚本自动化拉取或 Agent 自治安装：
  ```bash
  npx skills add team4u/actiondock -g -y
  ```
- **独立拷贝文件**：
  添加 `--copy` 强制复制技能目录而非创建符号链接：
  ```bash
  npx skills add team4u/actiondock -g --copy -y
  ```
- **仅在当前项目生效**：
  省略 `-g` 参数时，默认安装至当前项目根目录的技能文件夹，仅对当前工作区有效：
  ```bash
  npx skills add team4u/actiondock -y
  ```

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

除了通过 GitHub 安装公共技能外，开发团队亦可在本地通过 ActionDock CLI 将自研能力导出并分发为 Skill。

### 导出为源码型 Skill

适用于宿主环境已安装 Bun 运行时的智能体沙箱：

```bash
# 从本地已注册的 Action Package 导出
ad export skill -P team4u.github-tools --out ~/.claude/skills/github-tools

# 或在 Action Package 根目录就地导出
cd examples/github-tools
ad export skill --out ~/.claude/skills/github-tools
```

### 导出为独立二进制型 Skill

适用于宿主环境零依赖（未安装 Bun 或 Node.js）的服务器与沙箱环境：

```bash
ad export skill -P team4u.github-tools --standalone --out ~/.claude/skills/github-tools
```

导出的 Skill 会在内层 `./bin/` 目录下生成跨平台单文件二进制程序。智能体将直接通过该二进制文件调度执行，不依赖任何外部环境。

### 按规程按需精简裁剪

当底层工具包庞大，而特定业务仅需部分能力时，可通过指定 Playbook 导出精简版 Skill，减少智能体上下文干扰：

```bash
ad export skill -P team4u.github-tools --playbook review-pr --out ~/.claude/skills/review-pr
```

---

## 主流智能体客户端装载路径

不同智能体客户端在启动时会自动扫描特定目录下的 Skill 并注入模型上下文。

### Claude Code

Claude Code 原生支持文件系统技能发现：

- **用户全局生效**（推荐）：`~/.claude/skills/<skill-name>`
- **当前项目生效**：`<project-root>/.claude/skills/<skill-name>`

智能体启动后即可通过 `SKILL.md` 识别技能，无需手动挂载。

### Cursor 与 Windsurf

Cursor 与 Windsurf 提供双轨支持：

- **技能文件目录**：`<project-root>/.cursor/skills/<skill-name>`
- **MCP 协议挂载**：在 `mcp.json` 中配置 ActionDock STDIO 服务（`ad mcp --all`），将所有已注册能力转化为原生工具接口。

### Antigravity 与 Gemini CLI

Antigravity 原生支持工作区与全局双层发现机制：

- **用户全局生效**：`~/.gemini/antigravity-cli/skills/<skill-name>`
- **工作区生效**：`<workspace-root>/.gemini/skills/<skill-name>`

### GitHub Copilot CLI 与通用智能体

通用开源智能体客户端遵循标准化工作区路径：

- **工作区标准目录**：`<project-root>/.agents/skills/<skill-name>`

### 自研智能体系统与 SDK 集成

对于基于 LangChain、LlamaIndex 或自研 Agent 引擎的系统：

- **动态加载工具契约**：读取 Skill 根目录下的 `actiondock.skill.json`，将其中的 `actions` 字典转换为模型的 Tool Definition。
- **系统提示词注入**：将 `SKILL.md` 与目标 Playbook 文本直接注入为系统提示词或 RAG 检索知识库，使模型严谨遵循标准操作规程。

---

## 智能体如何调度与执行 Skill

智能体使用 ActionDock Skill 时，遵循规范的执行生命周期：

```text
意图匹配 (SKILL.md) ──► 规程决议 (Playbook) ──► 执行调用 (ad run / bin)
                                                       │
                                                       ▼
状态持久化 (ctx.state) ◄── 结果校验 (JSON Envelope) ◄──┘
```

### 意图匹配与技能激活

当用户发起自然语言提问（例如：“帮我审查当前仓库的 PR 101 并提交代码评审意见”），智能体根据系统提示词中已载入的 `SKILL.md` 描述和元数据，判定该任务匹配当前 Skill 并激活相应上下文。

### 规程优先决议准则

智能体在调度底层能力前，必须严格遵循**规程优先准则**：

- **优先遵循规程**：激活技能后，智能体必须首先检查是否存在匹配当前场景的 Playbook。若存在规程，必须执行 `ad playbook show <id>` 或阅读 `playbooks/<id>.md`，严格按照规程界定的操作时序、依赖条件与安全红线推进。
- **严禁无序拼凑**：严禁在规程存在的情况下，跳过规程直接猜测或无序调用底层 Action。
- **单点降级调用**：仅当无匹配规程或用户明确指示执行单点原子操作时，方可直接调用单一 Action。

### 确定性命令执行与参数传递

智能体通过终端命令执行 Action：

- **源码型调用方式**：
  ```bash
  ad run <action-id> --input '<json-string>'
  ```
- **独立二进制型调用方式**：
  ```bash
  ./bin/<tool-name> run <action-id> --input '<json-string>'
  ```

- **推荐最佳实践：使用文件传参**：
  在终端中直接拼接复杂 JSON 字符串时，引号转义极其容易被 Shell 解析器截断或损坏。
  推荐智能体将入参对象写入临时 JSON 文件，并通过 `--input-file` 传递：
  ```bash
  # 智能体先生成参数文件
  cat << 'EOF' > /tmp/input.json
  {
    "repo": "team4u/actiondock",
    "number": 101
  }
  EOF

  # 通过参数文件调用 Action
  ad run github.get-pr --input-file /tmp/input.json
  ```

### 结果解析与闭环反馈

ActionDock 所有 Action 执行完毕后均返回标准格式的 JSON Envelope：

```json
{
  "ok": true,
  "runId": "01JMBD6XYZ...",
  "data": {
    "number": 101,
    "title": "feat(core): support native skill distribution",
    "state": "open"
  }
}
```

智能体应当按如下逻辑处理输出：

- 检查 `ok` 字段：若为 `true`，提取 `data` 内的业务数据推进下一步。
- 若 `ok` 为 `false`，从 `error` 字段提取错误代码、详细原因与排查提示。
- 根据规程要求判定是否需要自愈重试，或向用户如实上报拦截原因，杜绝伪造或忽略失败。

### 跨步骤状态持久化

智能体在执行多步骤操作时，无需在各轮对话上下文间来回搬运巨量中间数据。
ActionDock 底座内置轻量级持久化存储（基于 SQLite），Action 执行过程中可通过 `ctx.state.set` 写入状态，后续 Action 通过 `ctx.state.get` 读取状态。
智能体多次调用相同包内的 Action 时，上下文状态自动保持连贯。

---

## 完整端到端实战案例

以 GitHub Pull Request 自动化评审为例，展示智能体如何使用 Skill 完成复合业务任务：

### 步骤一：安装技能

用户或运维在终端执行命令全局安装技能：

```bash
npx skills add team4u/actiondock -g -y
```

### 步骤二：用户向智能体发出业务指令

用户向智能体输入：“帮我评审 PR 101，检查其代码改动是否合规并发表评审意见。”

### 步骤三：智能体发现技能并加载规程

智能体在上下文激活 `actiondock` 技能，并检索到内置规程 `playbooks/review-pr.md`：

- **步骤要求**：
  - 调用 `github.get-pr` 获取目标 PR 基础信息与变更规模。
  - 调用 `github.review-pr` 执行自动化合规体检。
  - 调用 `github.comment-pr` 发表评审总结。
  - **安全红线**：未经用户明确许可，严禁调用自动合并指令。

### 步骤四：智能体按时序调度底层能力

- **获取 PR 基础信息**：
  ```bash
  ad run github-tools/github.get-pr --input '{"repo":"team4u/actiondock","number":101}'
  ```
  返回 PR 标题为新增功能，变更行数正常。

- **执行合规体检**：
  ```bash
  ad run github-tools/github.review-pr --input '{"repo":"team4u/actiondock","number":101}'
  ```
  体检通过，生成建议反馈清单。

- **发表评审意见**：
  ```bash
  ad run github-tools/github.comment-pr --input '{"repo":"team4u/actiondock","number":101,"comment":"代码规范检查通过，建议补充单元测试用例。"}'
  ```
  评论发表成功。

### 步骤五：智能体向用户汇报成果

智能体向用户反馈已按照评审规程完成体检，并附上已发表在 PR 讨论区的评审总结。

---

## 常见问题与排错指南

### 技能安装后智能体未能自动识别

- 确认安装路径是否与当前智能体支持的扫描目录一致。
- 确认目录中包含格式合规的 `SKILL.md`，且顶部包含合规的 YAML Frontmatter。
- 尝试重启智能体客户端以刷新文件索引缓存。

### 终端执行提示参数解析失败

- 检查是否在命令行直接传递包含未转义双引号的 JSON。
- 切换为 `--input-file <path>` 文件传参机制，保证参数原样输入。

### 缺少第三方服务凭据

- 对于需要外部鉴权的技能，可通过 ActionDock 全局配置注入：
  ```bash
  ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g
  ```
- 或直接在智能体运行环境中声明对应的环境变量。

### 沙箱或受限容器中无 Bun 运行时

- 使用携带 `--standalone` 导出的独立单文件 Skill。
- 直接执行 Skill 内置的 `./bin/<name>` 可执行文件，无需宿主具备任何语言解释器或依赖项。
