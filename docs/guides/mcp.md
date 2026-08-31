# 实践指南：Model Context Protocol (MCP) 集成

ActionDock 原生内置了对 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 标准的支持，无需编写任何额外的协议包装代码。

```text
Action Package (actions/*.ts)
             │
      ┌──────┴──────┐
      │  @actiondock/mcp
      │
 ┌────┴────┐   ┌────┴────┐
 │  STDIO  │   │  HTTP   │
 └─────────┘   └─────────┘
```

---

## 1. 启动 MCP 服务

### A. STDIO Transport 模式 (默认)
适用于 Claude Code、Cursor、Windsurf 等本地 IDE 客户端直接拉起进程：

```bash
ac mcp
```

### B. Streamable HTTP Transport 模式
适用于远程服务、多租户 Agent 平台或跨主机连接：

```bash
# 启动 HTTP 模式 MCP 服务（绑定 5178 端口并开启 Token 鉴权）
ac mcp --port 5178 --token my-secure-token
```

---

## 2. MCP 客户端配置

### Claude Code 配置 (`claude.json` 或 `settings.json`)
```json
{
  "mcpServers": {
    "my-tools": {
      "command": "ac",
      "args": ["mcp"],
      "cwd": "/path/to/my-tools"
    }
  }
}
```

### Cursor / Windsurf 配置
```json
{
  "mcpServers": {
    "my-tools": {
      "command": "ac",
      "args": ["mcp"],
      "cwd": "/path/to/my-tools"
    }
  }
}
```

### 独立二进制免安装模式
如果目标机器没有安装 Bun 或 `ac` CLI，可直接指定编译后的独立二进制：
```json
{
  "mcpServers": {
    "my-tools": {
      "command": "/usr/local/bin/my-tools",
      "args": ["mcp"]
    }
  }
}
```

---

## 3. 多包聚合与命名空间

`ac mcp` 支持一次性挂载多个 Action Package 目录或全局注册包：

```bash
# 挂载多个目录
ac mcp ./pkg1 ./pkg2

# 挂载全局注册表中的全部包
ac mcp --all
```
当不同包之间存在重名 Action 时，MCP 适配器会自动启用 Package 前缀命名空间（如 `team4u_github_tools__get_pr`），避免冲突。

---

## 4. MCP Tasks 异步长任务扩展

对于耗时较长（如代码编译、全量扫描、批量迁移）的 Action，ActionDock MCP 适配器原生支持 MCP Tasks 扩展：

- `tasks/get`：获取异步任务的实时执行状态。
- `tasks/cancel`：取消正在运行的异步任务（触发 `ctx.signal`）。
- `tasks/list`：查询历史任务列表。
