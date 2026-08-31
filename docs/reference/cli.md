# 参考手册：CLI 命令行速查 (`ac`)

`ac` 是 ActionDock 的核心命令行工具。

---

## 全量命令列表

### 1. 项目生命周期
```bash
ac init [directory] [--id <package-id>] [--name <name>] [--desc <desc>]
ac info [--json] [--profile <name>]
```

### 2. Action 开发与执行
```bash
# 脚手架创建 Action
ac action create <id> [--desc <description>] [--file <file.ts>]

# 运行 Action（本地或远程）
ac run <action-id> [--input <json-or-file>] [--config <k=v>] [--profile <name>] [--async]

# 纯内存单元测试
ac test [file]
```

### 3. 构建与分发
```bash
# 编译单文件零依赖独立可执行文件
ac build [--out <path>] [--bytecode] [--minify]

# 导出自包含 Agent Skill 交付包
ac export skill [--out <dir>] [--standalone] [--playbook <id>]
```

### 4. 协议与服务
```bash
# 启动 Model Context Protocol 服务
ac mcp [--port <port>] [--token <token>] [--all]

# 启动 HTTP 远程调度微服务
ac serve [--host <host>] [--port <port>] [--token <token>]
```

### 5. Playbook 规程
```bash
ac playbook validate [file]
```

### 6. 配置与状态管理
```bash
# 配置管理（默认当前项目，-g 作用于全局 ~/.actiondock/global.db）
ac config list [patterns...] [-g] [-P <pkg>] [--json]
ac config get <key> [-g] [-P <pkg>] [--reveal] [--json]
ac config set <key> <value> [-g] [-P <pkg>]
ac config delete <key> [-g] [-P <pkg>]
ac config schema [pkg]                       # 检查配置声明与就绪状态
```

# 状态管理
ac state list [--namespace <ns>]
ac state get <key> [--namespace <ns>]
ac state set <key> <value> [--namespace <ns>] [--ttl <seconds>]
ac state delete <key> [--namespace <ns>]

# 运行历史
ac runs list [--limit <number>] [--status <status>]
ac runs get <run-id>
ac runs clean [--older-than <duration>]
```

### 7. 多环境 Profile 与全局注册
```bash
# Profile 管理
ac profile list
ac profile add <name> --endpoint <url> [--token <token>] [--token-env <env>]
ac profile use <name>
ac profile remove <name>

# 全局包注册与解绑 (ActionDock 路由表，区别于 bun link 依赖解析)
ac link [path]          # 注册当前或指定包到全局开发态注册表（支持跨目录 ac run pkg/action）
ac unlink [id|path]     # 从全局注册表中移除
```

---

## 标准 JSON Envelope 输出格式

当命令成功执行完成时，`stdout` 输出如下机器可解析 JSON：

```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": { ... }
}
```

当命令执行失败时，`stdout` 输出错误 JSON Envelope：

```json
{
  "ok": false,
  "runId": "01JMB394...",
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "参数校验失败: /prNumber must be number",
    "details": [ ... ]
  }
}
```
