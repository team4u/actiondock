# 接入集成开发环境 MCP 服务

ActionDock 原生支持 Model Context Protocol 规范。
系统可直接将 Action Package 挂载为本地 STDIO 服务。
Cursor、Windsurf 或 Claude Code 藉此获得调用工具包的能力。

---

## 快速配置

在对应工具的配置文件中添加服务定义。
配置文件可使用 `~/.cursor/mcp.json` 或 Claude Desktop 的 `claude_desktop_config.json`。

### 挂载当前项目工程及其已锁定依赖

若已在工程中通过 `ad add` 安装依赖包，可将配置中的工作目录指向工程根目录。
执行引擎会自动加载该工程及其锁定的跨包能力：

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

### 全局挂载所有已链接包

对于通过本地克隆并执行 `ad link` 注册的包，可传入 `--all` 参数。
该参数将开发者全局路由表中的所有包暴露给集成开发环境：

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

## 常用工具配置文件路径速查

| 客户端 | 配置文件路径 |
| :--- | :--- |
| **Claude Code** | `~/.claude.json` 或项目根目录 `.claude.json` |
| **Claude Desktop (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop (Windows)** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Cursor** | Cursor 内部的 MCP 配置文件 (`~/.cursor/mcp.json`) |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |

---

## 多包聚合与高级参数

### 聚合多个 Action Package 目录

`ad mcp` 支持挂载多个工具包目录。
重名 Action 会自动附加包名命名空间：

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
- 客户端发起长任务后立即获得任务句柄，并进入流式等待。
- 客户端发送取消请求时直接触发服务端的 `ctx.signal`，中止底层任务。
