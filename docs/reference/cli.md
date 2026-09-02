# 参考手册：CLI 命令行速查 (`ac`)

`ac` 是 ActionDock 的核心命令行工具。

---

## 全量命令列表

### 1. 项目生命周期、元数据与能力发现
```bash
# 脚手架初始化项目
ac init [directory] [--id <package-id>] [--name <name>] [--desc <desc>]

# 元数据检查与意图模糊探索（首选能力发现入口）
ac info [patterns...] [-i <intent>] [--no-fallback] [-P <pkg>] [--json] [--profile <name>] [--server <url>] [--token <token>]
```

### 2. Action 开发与执行
```bash
# 脚手架创建 Action
ac action create <id> [--desc <description>] [--file <file.ts>]

# 发现与检索 Action（支持模糊搜索与正则意图）
ac action list [patterns...] [-i <intent>] [--no-fallback] [--json]

# 查看 Action 详情与 Schema 定义
ac action show <id> [--json]

# 校验 Action 语法与 Schema
ac action validate [id] [--json]

# 运行 Action（本地或远程）
ac run <action-id> [--input <json-or-file>] [--config <k=v>] [--profile <name>] [--timeout <time>] [--async]
ac run <package-id>/<action-id> --input '<json>'    # Package-Qualified ID

# 纯内存单元测试
ac test [file]
```

### 3. 构建与分发
```bash
# 编译单文件零依赖独立可执行文件（支持 -P 跨目录构建）
ac build [-P <package-id>] [--target <target>] [--out <path>] [--actions <actions...>] [--bytecode] [--minify]

# 导出自包含 Agent Skill 交付包（支持 -P 跨目录导出与 Playbook 按需裁剪）
ac export skill [-P <package-id>] [--out <dir>] [--standalone] [--playbook <id>] [--archive]
```

### 4. 协议与服务
```bash
# 启动 Model Context Protocol (MCP) 服务（STDIO 默认）
ac mcp [-d <dir>] [--package <id>] [--all] [--timeout <duration>]

# 启动 MCP HTTP 微服务
ac mcp serve [--host <host>] [--port <port>] [--token <token>] [--cors-origin <origin>]

# 启动 HTTP 远程调度 Runner 服务
ac serve [--host <host>] [--port <port>] [--token <token>] [--cors-origin <origin>] [--max-body <size>]
```

### 5. Playbook 规程
```bash
# 脚手架创建 Playbook
ac playbook create <id> [--desc <description>] [--actions <actions...>]

# 列出 Playbook 规程（项目内或跨全局 linked packages）
ac playbook list [patterns...] [-i <intent>] [--no-fallback] [--json]

# 查看 Playbook 详情（支持全局自动查找）
ac playbook show <id> [--json]

# 校验 Playbook 语法与 Action 引用
ac playbook validate [id] [--json]
```

### 6. 配置与状态管理
```bash
# 配置管理（默认当前项目，-g 作用于全局 ~/.actiondock/global.db）
ac config list [patterns...] [-g] [-P <pkg>] [-i <intent>] [--reveal] [--json]
ac config get <key> [-g] [-P <pkg>] [--reveal] [--json]
ac config set <key> <value> [-g] [-P <pkg>]
ac config delete <key> [-g] [-P <pkg>]
ac config schema [pkg]                       # 检查配置声明与就绪状态

# 状态管理（支持跨包聚合、命名空间隔离与复合 Key "pkg/namespace:key" 智能解析）
ac state list [prefix] [-P <pkg>] [-n <ns>] [-i <intent>] [-d|--detail] [--json]
ac state get <key> [-P <pkg>] [-n <ns>] [--json]
ac state set <key> <value> [-P <pkg>] [-n <ns>] [--ttl <seconds>]
ac state delete <key> [-P <pkg>] [-n <ns>] [--silent]
ac state clear [prefix] [-P <pkg>] [-n <ns>] [-a|--all]

# 运行历史
ac runs list [patterns...] [-P <pkg>] [-i <intent>] [--action <id>] [--limit <number>] [--json]
ac runs show <run-id> [-P <pkg>] [--profile <name>] [--json]
ac runs cancel <run-id> [--profile <name>] [--reason <reason>]
```

### 7. 多环境 Profile 与全局注册
```bash
# Profile 管理
ac profile list [--reveal] [--json]
ac profile add <name> --server <url> [--token <token>] [--token-env <env>] [--desc <desc>]
ac profile show [name] [--reveal] [--json]
ac profile test <name>
ac profile use <name>
ac profile remove <name>

# 全局包与工作区注册与解绑 (ActionDock 路由表，支持子项目自动发现与零操作动态感知)
ac link [path]                     # 智能注册：单包目录注册单包，多包目录自动扫描并挂载 Workspace（新增子包零操作感知）
ac link [path] -r, --recursive     # 强制递归：在包内嵌套子包的复杂结构下强制深度扫描并挂载 Workspace
ac unlink [id|path]                # 从全局注册表中移除指定包或工作区
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
