# 消费与接入总览 (Consumer Overview)

作为 ActionDock 制品的**使用者（Consumer）**，不需要关心底层如何编写 TypeScript 逻辑或编译器实现。无论是克隆了官方仓库体验示例包、获得了导出的 Skill 交付物，还是下载了独立二进制，都能以最极简的方式快速接入。

---

## 2 分钟极速上手（基于官方示例）

ActionDock 具备两大开箱即用特性：
1. **零手动依赖安装（Zero-install）**：首次执行 `ac run` 时，ActionDock 会自动检测并静默安装所需依赖（如 `bun install`），无需手动执行安装步骤。
2. **开箱即用 Demo 降级（Zero-config）**：官方内置示例（如 `github-tools`）自带 Mock 数据降级逻辑。在未配置真实 Token 时直接返回示例数据，无需准备 GitHub Token 即可立即体验完整流。

### 步骤 1：克隆官方仓库并自动注册

```bash
# 1. 克隆官方仓库
git clone https://github.com/team4u/actiondock.git
cd actiondock

# 2. 直接在仓库根目录执行 link（自动识别工作区，一键发现并注册全部内置示例包）
ac link
```
> `ac link` 会自动扫描仓库内的子项目，输出类似：  
> `[OK] Linked workspace '.../actiondock' (1 package): team4u.github-tools -> ...`

---

### 步骤 2：直接在任意目录运行第一个 Action

无需进入子目录，也无需手动 `bun install`，在系统任意终端路径直接调用：

```bash
ac run github-tools/github.list-prs --input '{"repo": "team4u/actiondock"}'
```

输出标准 JSON Envelope：
```json
{
  "ok": true,
  "runId": "01JMBD6...",
  "data": {
    "items": [
      {
        "number": 101,
        "title": "feat(core): support bun native compilation",
        "author": "octocat",
        "state": "open"
      },
      {
        "number": 102,
        "title": "fix(storage): improve sqlite concurrency with wal",
        "author": "team4u",
        "state": "open"
      }
    ],
    "count": 2
  }
}
```

> **提示**：也可以直接进入示例目录就地运行（无需经过 `ac link`）：
> ```bash
> cd examples/github-tools
> ac run github.list-prs --input '{"repo": "team4u/actiondock"}'
> ```

---

### 步骤 3：一键体验 4 种消费形态

依托刚刚已注册的 `github-tools` 示例，你可以立即体验不同的消费姿态：

#### 姿态 1：挂载为 IDE 的 MCP 服务（Cursor / Windsurf / Claude Code）
在 IDE 的 `mcp.json` 中添加 `--all` 参数，即可一键挂载已 link 的所有工具包：
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

#### 姿态 2：导出为 Agent Skill（Claude Code / Antigravity）
一键将示例导出为带 SOP 规程的标准 Skill 并放入技能目录：
```bash
ac export skill -P team4u.github-tools --out ~/.claude/skills/github-tools
```

#### 姿态 3：启动本地 HTTP 微服务
```bash
cd examples/github-tools
ac serve --port 8080
# 即可通过 cURL 或 REST API 远程调度 Action
```

#### 姿态 4：一键构建为零依赖独立二进制
```bash
cd examples/github-tools
ac build
# 产生 ./bin/github-tools 单文件，可在任意服务器/沙箱免 Node/Bun 独立运行
./bin/github-tools run github.list-prs --input '{"repo": "team4u/actiondock"}'
```

---

### 步骤 4：注入真实凭证（从 Demo 切换到真实 API）

当需要请求真实 GitHub 数据时，只需注入 Token：

```bash
# 全局生效（对所有跨目录调用的 linked package 生效）
ac config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g

# 再次调用即可获取真实的 GitHub PR 列表
ac run github-tools/github.list-prs --input '{"repo": "team4u/actiondock"}'
```

---

## 消费姿态对比速查

| 消费姿态 | 适用场景 | 目标客户端 / 宿主 | 环境依赖 |
| :--- | :--- | :--- | :--- |
| **Agent Skill** | 大模型自主理解 SOP 并调度 | Claude Code, Antigravity, Codex | 源码型需 Bun；独立型零依赖 |
| **MCP 服务** | 本地 IDE 扩展工具调用 | Cursor, Windsurf, Claude Code, VSCode | 本地安装 `ac` CLI 或指定独立二进制 |
| **独立单文件 CLI** | 终端手动执行 / CI 脚本 / 容器 | Linux, macOS, Windows 终端 / CI 沙箱 | **零依赖**（无需 Bun/Node） |
| **HTTP 远程微服务** | 远程集群 / 多租户 SaaS / REST 调度 | 任意支持 HTTP/cURL 的 Agent 或业务系统 | 服务端需 `ac serve` 运行 |

---

## 全局能力探索 (`ac info`)

想了解当前环境中有哪些包与 Action 可用时：

```bash
# 查看所有已 link 的工作区与包
ac info

# 模糊意图匹配（如搜索 github 相关能力）
ac info github

# 查看工作区层级树
ac info --tree
```

---

## 各消费姿态接入指南

- [接入 Cursor / Windsurf / IDE (MCP 服务)](/consumer/use-as-mcp.md)：IDE 配置文件中添加 STDIO MCP Server。
- [接入 Claude Code / Antigravity (Agent Skill)](/consumer/use-as-skill.md)：将 Skill 放入技能目录让 AI 自动发现与执行 SOP。
- [独立二进制单文件运行 (零环境依赖)](/consumer/standalone-run.md)：在生产服务器或沙箱中免依赖运行。
- [HTTP 远程微服务与 REST 调度](/consumer/http-service.md)：启动 HTTP 服务并通过 cURL 或 API 远程调用。
- [消费端配置与凭证注入](/consumer/configuration.md)：配置覆盖、环境变量与安全 Token 管理。
