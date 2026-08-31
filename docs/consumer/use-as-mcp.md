# 接入 Cursor / Windsurf / IDE (MCP 服务)

ActionDock 原生支持 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 标准，你可以直接将 Action Package 挂载为本地 IDE 的 MCP STDIO Server，让 Cursor、Windsurf 或 Claude 获得调用该工具包的能力。

---

## 1. 快速配置

在 IDE 的 MCP 配置文件（如 `~/.cursor/mcp.json` 或 Claude Desktop 的 `claude_desktop_config.json`）中添加：

### 模式 A：基于本地 Action Package 源码运行
如果本地已安装了 `ac` CLI（或克隆了源码包）：

```json
{
  "mcpServers": {
    "github-tools": {
      "command": "ac",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/my-action-tools"
    }
  }
}
```

### 模式 B：基于独立单文件二进制运行（免环境依赖）
如果目标开发机没有安装 Bun 或 `ac`，直接指向编译后的独立可执行文件：

```json
{
  "mcpServers": {
    "github-tools": {
      "command": "/usr/local/bin/github-tools",
      "args": ["mcp"]
    }
  }
}
```

---

## 2. 常用 IDE 配置路径速查

| IDE / 客户端 | 配置文件绝对路径 |
| :--- | :--- |
| **Claude Code** | `~/.claude.json` 或项目根目录 `.claude.json` |
| **Claude Desktop (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop (Windows)** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Cursor** | Cursor 设置 $\rightarrow$ MCP $\rightarrow$ Add New MCP Server |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |

---

## 3. 多包聚合与高级参数

### 聚合多个 Action Package 目录
`ac mcp` 支持一次性挂载多个工具包目录，重名 Action 会自动附加包名命名空间：

```bash
ac mcp /path/to/pkg1 /path/to/pkg2
```

### 挂载全局所有注册包
如果之前在多个项目下执行过 `ac link`，可直接使用 `--all` 一键暴露全局所有包：

```bash
ac mcp --all
```

---

## 4. MCP Tasks 异步长任务支持

对于耗时较长的 Action（如大规模数据同步、编译、长时审查），ActionDock MCP 适配器原生支持 MCP Tasks 规范：
- 客户端发起长任务后立即获得任务句柄并进入非阻塞流式等待。
- 支持客户端发送取消信号（直接触发服务端的 `ctx.signal` 中止任务）。
