# AI Agent 接入与集成指南

# 背景

随着大语言模型与自主智能体（Autonomous Agents）的迅速普及，开发者需要将外部工具高效、安全地接入各类主流 Agent 宿主（如 Antigravity、Claude Code、Cursor、Windsurf、LangChain、AutoGen 等）。

然而，传统的工具集成方案通常存在显著摩擦：
- **运行环境强耦合**：Agent 必须在沙箱中执行 `pip install` 或 `npm install`，极易因网络抖动或版本不兼容而失败。
- **协议不统一**：部分 Agent 仅支持 MCP 协议，部分 Agent 仅支持 CLI 子进程调用，开发同一套工具往往需要编写多套适配层。
- **缺乏业务 SOP 引导**：工具缺乏操作规程，Agent 容易发生调用顺序错误或触发危险操作。

ActionDock 2.0 提供了 **MCP 协议直连** 与 **自包含独立 Skill 交付包** 两种业界通用的集成范式，实现了一次编写、全生态无缝接入。

---

# 两种接入范式对比

```mermaid
graph TD
    subgraph Action Package (ActionDock)
        Actions["Actions (TypeScript + Schema)"]
    end

    Actions -->|ac mcp / ac mcp serve| MCP["范式一：MCP 协议直连<br/>(STDIO / Streamable HTTP)"]
    Actions -->|ac export skill| Skill["范式二：自包含 Skill 交付包<br/>(SKILL.md + 独立二进制)"]

    MCP --> Claude["Claude Code / Claude Desktop"]
    MCP --> Cursor["Cursor / Windsurf"]
    MCP --> VSCode["VS Code (MCP 插件)"]

    Skill --> AGY["Antigravity / Google AGY"]
    Skill --> Sandbox["沙箱容器 / 隔离生产环境"]
    Skill --> Custom["自定义 LLM Agent / LangChain / AutoGen"]
```

| 维度 | 范式一：MCP 协议直连 | 范式二：自包含 Skill 交付包 |
| :--- | :--- | :--- |
| **通信机制** | JSON-RPC 2.0（STDIO / HTTP） | 子进程命令行调用（`./bin/pkg`） |
| **接入配置** | MCP 客户端配置文件（`mcp.json`） | 放置于 Agent 的 Skills 目录 |
| **目标环境要求** | 本地需安装 `ac` 或 `bunx` | **零依赖** （目标机器无需预装 Node/Bun/Python） |
| **适用场景** | 桌面端 IDE、本地开发调试、远程微服务 | 生产沙箱、无网络环境、自动化流程与多云调度 |

---

# 范式一：作为 Model Context Protocol (MCP) 接入

若您的 Agent 宿主原生支持 MCP 协议，推荐使用 MCP 直连：

### Claude Code 直连配置 (`~/.claude/mcp.json`)
```json
{
  "mcpServers": {
    "actiondock-tools": {
      "command": "bunx",
      "args": [
        "@actiondock/cli",
        "mcp",
        "-d",
        "/path/to/my-tools",
        "-d",
        "/path/to/other-tools"
      ]
    }
  }
}
```

### Cursor / Windsurf 直连配置 (`settings.json`)
```json
{
  "mcpServers": {
    "actiondock-tools": {
      "command": "ac",
      "args": ["mcp", "--all"]
    }
  }
}
```

### 远程 HTTP 微服务接入
在远程服务器启动 `ac mcp serve` 后，客户端直接配置 HTTP 端点：
```bash
ac mcp serve --host 0.0.0.0 --port 5178 --token <secret-token>
```

---

# 范式二：自包含 Skill 交付包接入

通过 `ac export skill` 导出的 Skill 交付包包含：
```text
dist/github-tools-skill/
├── SKILL.md                  # 面向 AI Agent 的主引导手册（含标准 YAML Frontmatter）
├── actiondock.skill.json     # 机器可读的结构化清单
├── playbooks/                # 任务 SOP 规程目录
└── bin/
    └── github-tools          # 独立自包含二进制（零外部依赖）
```

### 接入 Google Antigravity / AGY
将导出的 Skill 目录放置在用户或工作区的技能目录下：
- 全局路径：`~/.gemini/antigravity-cli/custom/skills/github-tools/`
- 项目路径：`<项目根目录>/.gemini/skills/github-tools/`

Antigravity 会自动扫描 `SKILL.md` 的 YAML Frontmatter，在规划任务时自动激活该 Skill，并执行 `./bin/github-tools` 完成调用。

---

### 接入 Claude Code Skills 目录
```bash
# 将导出的 Skill 复制到 Claude Code 技能库
cp -r dist/github-tools-skill ~/.claude/skills/github-tools
```
Claude Code 会在处理相关提示词时自动阅读 `SKILL.md` 并直接运行自包含二进制。

---

### 接入 Cursor / Windsurf (通过 `.cursorrules` / System Prompt)
在项目根目录的 `.cursorrules` 或 Agent 系统提示词中引入：

```markdown
你可以使用 `./dist/github-tools-skill/bin/github-tools` 命令行工具完成 GitHub 相关的自动化操作。
详细操作规范请参阅 `./dist/github-tools-skill/SKILL.md`。

常用命令：
- 发现可用工具：`./dist/github-tools-skill/bin/github-tools list --json`
- 查看入参规范：`./dist/github-tools-skill/bin/github-tools describe <action-id> --json`
- 执行工具调用：`./dist/github-tools-skill/bin/github-tools run <action-id> --input '{"key": "value"}'`
```

---

### 接入自定义 Python / LangChain / AutoGen Agent
在 Python Agent 中直接通过子进程调用独立二进制，并解析标准 JSON Envelope：

```python
import json
import subprocess

def run_actiondock_action(binary_path: str, action_id: str, input_params: dict) -> dict:
    cmd = [
        binary_path,
        "run",
        action_id,
        "--input",
        json.dumps(input_params)
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    
    # 解析 stdout 标准 JSON Envelope
    envelope = json.loads(result.stdout)
    if not envelope.get("ok"):
        raise RuntimeError(f"Action 失败: {envelope.get('error')}")
        
    return envelope.get("data")

# 调用示例
data = run_actiondock_action(
    "./dist/github-tools-skill/bin/github-tools",
    "github.get-user",
    {"username": "torvalds"}
)
print("GitHub 用户信息:", data["name"])
```

---

# 为什么 ActionDock 交付模式最适合 AI Agent？

- **双模自由切换（Dual-Mode Delivery）**：既可在本地 IDE 中通过 MCP 协议低延迟直连，也可编译为自包含二进制跨服务器直接分发。
- **零安装负担（Zero-Install Guarantee）**：独立二进制模式下无需在宿主机上预装 Node.js、Bun 或 Python，杜绝依赖冲突。
- **输出绝对纯净（Clean Stdio Separation）**：所有数据严格输出至 `stdout`，日志输出至 `stderr`，Agent 不会因控制台杂乱输出而发生 JSON 解析崩溃。
- **内置 SOP 约束（Playbook Driven）**：除了函数接口外附带业务操作 SOP，大幅降低 Agent 产生幻觉或执行高危操作的风险。

---

# 文档导航

- [Model Context Protocol 适配器指南](mcp-integration.md)：深入学习 MCP 协议高级配置与 MCP Tasks 扩展。
- [Skill 设计哲学与交付规范](skill-guide.md)：学习标准 Skill 交付包设计与导出规范。
- [Playbook SOP 编写指南](playbook-guide.md)：为 Agent 编写结构化业务操作规程。
