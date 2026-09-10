# 接入集成开发环境 MCP 服务

ActionDock 原生支持 Model Context Protocol 协议规范，可以直接将 Action Package 挂载为集成开发环境的本地 STDIO 服务，让 Cursor、Windsurf 或 Claude Code 获得调用工具包的能力。

---

## 快速配置

在对应工具的配置文件（如 `~/.cursor/mcp.json` 或 Claude Desktop 的 `claude_desktop_config.json`）中添加配置：

### 挂载当前项目工程及其已锁定依赖（推荐）
若在 ActionDock 项目工程中已通过 `ad add` 安装了所需的 Action 依赖包，可在配置中直接将工作目录指向该工程根目录。执行引擎将自动加载该工程及其锁定的全部跨包能力：

```json
{
  "mcpServers": {
    "my-project-tools": {
      "command": "ad",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/my-project"
    }
  }
}
```

---

### 全局一键挂载所有已链接包
对于通过本地克隆并执行过 `ad link` 注册的包，可直接使用 `--all` 参数将开发者全局路由表中的所有包一次性暴露给集成开发环境：

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

---

### 指定具体包源码目录挂载
通过 `--dir` 或指定工作目录挂载特定的工具包：

```json
{
  "mcpServers": {
    "github-tools": {
      "command": "ad",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/actiondock/examples/github-tools"
    }
  }
}
```

---

### 基于已构建交付目录挂载
使用构建出的自包含交付目录中的独立入口脚本启动，无需宿主安装 `ad` 命令行工具：

```json
{
  "mcpServers": {
    "github-tools": {
      "command": "node",
      "args": ["/absolute/path/to/dist/delivery/entry.mjs", "mcp"]
    }
  }
}
```

---

## 常用工具配置文件路径速查

| 客户端 | 配置文件路径 |
| :--- | :--- |
| **Claude Code** | `~/.claude.json` 或项目根目录 `.claude.json` |
| **Claude Desktop (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop (Windows)** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Cursor** | Cursor 设置中的 MCP 配置项 (`~/.cursor/mcp.json`) |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |

---

## 多包聚合与高级参数

### 聚合多个 Action Package 目录
`ad mcp` 支持一次性挂载多个工具包目录，重名 Action 会自动附加包名命名空间：

```bash
ad mcp -d ./examples/github-tools -d ./packages/my-custom-tools
```

### 挂载全局所有注册包
```bash
ad mcp --all
```

---

## 异步长任务支持

对于耗时较长的 Action（如大规模数据同步、编译、长时代码审查），ActionDock MCP 适配器原生支持长任务机制：
- 客户端发起长任务后立即获得任务句柄并进入流式等待。
- 客户端发送取消请求时直接触发服务端的 `ctx.signal` 中止底层任务。
