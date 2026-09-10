# 参考手册：Agent Skill 消费与使用指南

本参考手册面向智能体宿主环境与技能使用者，规范技能资产安装、客户端装载路径、冷启动依赖就绪，以及引导智能体正确调度与执行技能的完整生命周期。

---

## 技能资产架构

导出的 Agent Skill 资产具备标准化、自包含的目录结构：

```text
               ┌─ SKILL.md                 # 智能体技能说明与规程索引
               ├─ playbooks/               # 领域标准操作规程
Agent Skill ───┼─ actions/                 # 原子能力契约与业务实现
               └─ dist/ 或 node_modules/   # 编译产物与物化依赖
```

---

## 技能获取与安装途径

### 从 GitHub 一键安装技能

通过技能管理工具直接从 GitHub 开源仓库发现与安装技能：

```bash
# 全局安装官方技能（供当前机器所有智能体使用）
npx skills add team4u/actiondock -g -y

# 全局安装第三方仓库技能
npx skills add <owner/repo> -g -y

# 查看与维护已安装技能
npx skills list -g
npx skills update
npx skills remove <skill-name>
```

- 常用参数：
  - `-g, --global`：全局安装至当前用户目录。
  - `-y, --yes`：跳过交互式确认，适用于自动化脚本与智能体自治安装。
  - `--copy`：强制独立拷贝文件而非创建符号链接。

---

## 离线与导出技能目录冷启动工序

当以源码目录或解压离线包形式获取技能时，在目标环境中按以下工序完成冷启动：

- **确认运行时底座**：确保目标机器具备 Node.js 运行环境（建议版本大于等于 24.12.0）。
- **安装命令行工具链**：在终端执行 `npm install -g @actiondock/cli`。若受限无全局权限，亦可通过 `npx @actiondock/cli` 执行。
- **安装技能源码依赖**：进入技能根目录，物化本地生产依赖：
  ```bash
  npm install --omit=dev
  ```
  > 多包复合套件技能在聚合根目录下执行一次安装即可物化所有子包依赖。
- **全局注册挂载**：在技能根目录执行注册命令：
  ```bash
  ad link .
  ```
  该命令会自动将技能登记至本机全局路由表中（`~/.actiondock/registry.json`），使智能体在任意工作目录下均可直接调用。
- **契约查验与试跑**：
  ```bash
  # 查验 Action 接口契约
  ad describe <package-id>/<action-id>
  # 试运行调用
  ad run <package-id>/<action-id> --input '{"key": "value"}'
  ```

---

## 主流智能体客户端装载路径

不同客户端在启动时会自动扫描特定目录下的 Skill 并注入模型上下文：

- **Claude Code**：
  - 用户全局生效：`~/.claude/skills/<skill-name>`
  - 当前项目生效：`<project-root>/.claude/skills/<skill-name>`
- **Cursor 与 Windsurf**：
  - 技能文件目录：`<project-root>/.cursor/skills/<skill-name>`
  - MCP 协议原生挂载：在 `mcp.json` 中配置 `"command": "ad", "args": ["mcp", "--all"]`。
- **Antigravity 与 Gemini CLI**：
  - 用户全局生效：`~/.gemini/antigravity-cli/skills/<skill-name>`
  - 工作区生效：`<workspace-root>/.gemini/skills/<skill-name>`
- **自研智能体与通用 SDK**：
  - 将 `SKILL.md` 与目标 Playbook 正文直接注入系统提示词。
  - 动态执行 `ad describe <id> --json` 获取模式契约，精准对接函数调用。

---

## 智能体调度与执行生命周期（引导法则）

当智能体装载并使用 ActionDock 技能时，必须遵循以下标准化执行流程：

```text
意图匹配 (SKILL.md) ──► 规程优先决议 ──► 参数契约调阅 ──► 执行调用 (ad run)
                                                                 │
                                                                 ▼
持久化追踪 (ctx.state) ◄── 信封校验与错误处置 ◄────────────────────┘
```

- **第一阶段：意图匹配与技能激活**：
  - 智能体根据系统提示词中已载入的 `SKILL.md` 描述与触发条件，自主判定当前任务匹配该技能并激活上下文。
- **第二阶段：规程优先决议准则**：
  - 激活技能后，智能体必须首先检查是否存在匹配当前场景的 Playbook 规程。
  - 若存在规程，必须执行 `ad playbook show <id>` 读取规程内容，严格按照规程界定的步骤时序、前置依赖与安全红线推进。
  - **严禁无序拼凑**：严禁在规程存在的情况下，跳过规程直接猜测或无序调用底层 Action。
  - **单点降级调用**：仅当无匹配规程或用户明确指示执行单点操作时，方可直接调用单一 Action。
- **第三阶段：参数契约按需调阅**：
  - 为节省上下文开销，各 Action 的详细参数结构不静态内嵌在说明书中。
  - 在调用未知参数的 Action 前，智能体必须在终端执行 `ad describe <id>` 动态获取该 Action 的输入输出模式与必填字段。
  - 杜绝参数猜测与伪造属性，确保传参严格符合 `inputSchema` 约束。
- **第四阶段：确定性执行调用**：
  - 推荐参数文件传递：简单标量参数可使用 `--input '{"key": "val"}'`；包含对象、数组或引号多行文本的复杂参数，必须先写入临时 JSON 文件，再通过 `ad run <id> --input-file /tmp/input.json` 传递，杜绝终端引号转义损坏。
  - 异步长任务支持：耗时操作添加 `--async` 参数（如 `ad run <action> --input-file <path> --async`），获取包含 `runId` 的票据。
- **第五阶段：信封结果校验与错误处置**：
  - 统一解析终端输出的标准 JSON 信封：
    - `ok: true`：提取 `data` 节点获取业务执行结果。
    - `ok: false`：提取 `error.code` 与 `error.message`。遇到报错时查阅 [troubleshooting.md](file:///root/code/action-dock/skills/actiondock/references/troubleshooting.md) 定向自愈。
- **第六阶段：跨生命周期状态与运行追踪**：
  - 异步任务执行 `ad runs show <runId>` 追踪执行进度与事件流；必要时执行 `ad runs cancel <runId>` 取消。
  - Action 持久化状态自动跨多次执行保持，支持通过 `ad state get` 查验上下文延续。
