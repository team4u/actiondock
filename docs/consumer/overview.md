# 消费与接入总览

作为 ActionDock 框架的使用者，不需要关心底层如何编写 TypeScript 逻辑或编译器细节。无论是克隆了官方仓库体验示例包、获得了导出的 Skill 交付物，还是获取了 Node.js 运行时交付目录，都能以极简方式快速接入。

---

## 极速上手体验

ActionDock 具备两大开箱即用特性：
- 自动依赖发现：执行 `ad run` 时，ActionDock 会自动检测并确保所需依赖完备，无需繁复的手动前置操作。
- 开箱即用示例降级：官方内置示例自带模拟数据降级逻辑。在未配置真实 Token 时直接返回模拟数据，无需准备外部 Token 即可立即体验完整执行流。

### 克隆官方仓库并自动注册

```bash
# 克隆官方仓库
git clone https://github.com/team4u/actiondock.git
cd actiondock

# 在仓库根目录执行 link（自动识别工作区，一键发现并注册全部内置示例包）
ad link
```

### 在任意目录运行 Action

无需进入子目录，在系统任意终端路径直接调用：

```bash
ad run github-tools/github.list-prs --input '{"repo": "team4u/actiondock"}'
```

输出标准 JSON 信封：
```json
{
  "ok": true,
  "runId": "01JMBD6...",
  "data": {
    "items": [
      {
        "number": 101,
        "title": "feat(core): support native node execution",
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

---

## 体验不同消费形态

依托已注册的示例包，可以体验不同的消费姿态：

### 挂载为集成开发环境的 MCP 服务
在 Cursor、Windsurf 或 Claude Code 的 MCP 配置文件中添加 `--all` 参数，即可一键挂载已链接的所有工具包：
```json
{
  "mcpServers": {
    "actiondock-tools": {
      "command": "ad",
      "args": ["mcp", "--all"]
    }
  }
}
```

### 作为智能体 Skill 使用
智能体生态支持通过 `npx skills` 直接从 GitHub 全局安装技能，或通过 ActionDock CLI 一键导出本地包为带规程的标准 Skill：
```bash
# 方式一：使用 npx skills 直接从 GitHub 全局安装技能
npx skills add team4u/actiondock -g -y

# 方式二：本地一键导出并放入技能目录
ad export skill -P team4u.github-tools --out ~/.claude/skills/github-tools
```

### 启动本地 HTTP 微服务
```bash
cd examples/github-tools
ad serve --port 8080
```
启动后可通过 cURL 或网络请求远程调度动作，同时提供 MCP 协议端点与自省状态治理接口。

### 构建为 Node.js 运行时交付目录
```bash
cd examples/github-tools
ad build --out ./dist/delivery
# 产生可直接运行的 Node.js 交付目录，内嵌统一入口脚本
node ./dist/delivery/entry.js run github.list-prs --input '{"repo": "team4u/actiondock"}'
```

---

## 注入真实凭证

当需要请求真实数据时，注入对应配置项：

```bash
# 全局生效（对所有跨目录调用的已链接包生效）
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g

# 再次调用即可获取真实的数据响应
ad run github-tools/github.list-prs --input '{"repo": "team4u/actiondock"}'
```

---

## 消费姿态对比速查

| 消费姿态 | 适用场景 | 目标客户端与宿主 | 环境依赖 |
| :--- | :--- | :--- | :--- |
| **Agent Skill** | 模型自主理解规程并按需调度 | Claude Code, Antigravity, Cursor | 源码型需 Node.js 与 ad；目录型仅需 Node.js |
| **MCP 服务** | 本地集成开发环境扩展工具调用 | Cursor, Windsurf, Claude Code | 本地安装 `ad` 命令行工具 |
| **独立目录交付** | 生产服务器部署、流水线与容器 | Linux, macOS, Windows 服务器与容器 | 仅需兼容的 Node.js 运行时 |
| **HTTP 远程微服务** | 远程集群、多租户云服务、网络调度 | 任意支持网络请求的智能体或业务系统 | 服务端通过 `ad serve` 运行 |

---

## 全局能力探索

查看当前环境中可用的包与 Action：

```bash
# 查看所有已链接的工作区与包
ad info

# 模糊意图匹配搜索
ad info github

# 查看工作区层级树
ad info --tree
```

---

## 各消费姿态接入指南

- [接入集成开发环境 MCP 服务](file:///root/code/action-dock/docs/consumer/use-as-mcp.md)：配置文件中添加 STDIO MCP 服务。
- [Agent Skill 使用指南](file:///root/code/action-dock/docs/consumer/use-as-skill.md)：通过技能工具安装与规程优先调用规范。
- [Node.js 目录独立运行指南](file:///root/code/action-dock/docs/consumer/standalone-run.md)：在生产服务器或容器中免脚手架独立运行。
- [HTTP 远程微服务与网络调度](file:///root/code/action-dock/docs/consumer/http-service.md)：启动 HTTP 服务并通过网络接口远程调用。
- [消费端配置与凭证注入](file:///root/code/action-dock/docs/consumer/configuration.md)：配置覆盖、环境变量与安全令牌管理。
