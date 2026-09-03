# 参考手册：CLI 命令行速查 (`ad`)

`ad` 是 ActionDock 的核心命令行工具。

---

## 全量命令列表

### 项目生命周期、元数据与能力发现
```bash
# 脚手架初始化项目
ad init [directory] [--id <package-id>] [--name <name>] [--desc <desc>]

# 元数据检查与意图模糊探索（首选能力发现入口；支持 --tree 查看 Workspace 树形层级）
ad info [patterns...] [-i <intent>] [--tree] [--no-fallback] [-P <pkg>] [--json] [--profile <name>] [--server <url>] [--token <token>]

# 系统环境、注册表健康与项目诊断检查
ad doctor [-P <pkg>] [--json]
```

### Action 开发与执行
```bash
# 脚手架创建 Action
ad action create <id> [--desc <description>] [--file <file.ts>]

# 发现与检索 Action（支持模糊搜索与正则意图）
ad action list [patterns...] [-i <intent>] [--no-fallback] [--json]

# 查看 Action 详情与 Schema 定义
ad action show <id> [--json]

# 校验 Action 语法与 Schema
ad action validate [id] [--json]

# 运行 Action（本地或远程）
ad run <action-id> [--input <json-or-file>] [--config <k=v>] [--profile <name>] [--timeout <time>] [--async]
ad run <package-id>/<action-id> --input '<json>'    # Package-Qualified ID

# 纯内存单元测试
ad test [file]
```

### 构建与分发
```bash
# 编译单文件零依赖独立可执行文件（支持 -P 跨目录构建与 -t 全平台交叉编译）
ad build [-P <package-id>] [-t|--target <target>] [-o|--out <path>] [-a|--actions <actions...>] [--no-bytecode] [--no-minify]

# 导出自包含 Agent Skill 交付包（支持 -P 跨目录导出与 Playbook 按需裁剪）
ad export skill [-P <package-id>] [-o|--out <dir>] [-s|--standalone] [-t|--target <target>] [-p|--playbook <id>] [-z|--archive] [--no-bytecode] [--no-minify]
```

### 协议与服务
```bash
# 启动 MCP 服务（STDIO 默认）
ad mcp [-d <dir>] [--package <id>] [--all] [--timeout <duration>]

# 启动 MCP HTTP 微服务
ad mcp serve [--host <host>] [--port <port>] [--token <token>] [--cors-origin <origin>]

# 启动 HTTP 远程调度 Runner 服务
ad serve [--host <host>] [--port <port>] [--token <token>] [--cors-origin <origin>] [--max-body <size>]
```

### Playbook 规程
```bash
# 脚手架创建 Playbook
ad playbook create <id> [--desc <description>] [--actions <actions...>]

# 列出 Playbook 规程（项目内或跨全局 linked packages）
ad playbook list [patterns...] [-i <intent>] [--no-fallback] [--json]

# 查看 Playbook 详情（支持全局自动查找）
ad playbook show <id> [--json]

# 校验 Playbook 语法与 Action 引用
ad playbook validate [id] [--json]
```

### 配置与状态管理
```bash
# 配置管理（默认当前项目，-g 作用于全局 ~/.actiondock/global.db）
ad config list [patterns...] [-g] [-P <pkg>] [-i <intent>] [--reveal] [--json]
ad config get <key> [-g] [-P <pkg>] [--reveal] [--json]
ad config set <key> <value> [-g] [-P <pkg>]
ad config delete <key> [-g] [-P <pkg>]
ad config schema [pkg]                       # 检查配置声明与就绪状态

# 状态管理（支持跨包聚合、命名空间隔离与复合 Key "pkg/namespace:key" 智能解析）
ad state list [prefix] [-P <pkg>] [-n <ns>] [-i <intent>] [-d|--detail] [--json]
ad state get <key> [-P <pkg>] [-n <ns>] [--json]
ad state set <key> <value> [-P <pkg>] [-n <ns>] [--ttl <seconds>]
ad state delete <key> [-P <pkg>] [-n <ns>] [--silent]
ad state clear [prefix] [-P <pkg>] [-n <ns>] [-a|--all]

# 运行历史
ad runs list [patterns...] [-P <pkg>] [-i <intent>] [--action <id>] [--limit <number>] [--json]
ad runs show <run-id> [-P <pkg>] [--profile <name>] [--json]
ad runs cancel <run-id> [--profile <name>] [--reason <reason>]
```

### 多环境 Profile 与全局注册
```bash
# Profile 管理
ad profile list [--reveal] [--json]
ad profile add <name> --server <url> [--token <token>] [--token-env <env>] [--desc <desc>]
ad profile show [name] [--reveal] [--json]
ad profile test <name>
ad profile use <name>
ad profile remove <name>

# 全局包与工作区注册与解绑（ActionDock 路由表，查看树形请使用 ad info --tree）
ad link [path]                     # 智能注册：单包目录注册单包，多包目录自动扫描并挂载 Workspace（新增子包零操作感知）
ad link [path] -r, --recursive     # 强制递归：在包内嵌套子包的复杂结构下强制深度扫描并挂载 Workspace
ad unlink [id|path]                # 从全局注册表中移除指定包或工作区
ad unlink --prune                  # 自动扫描并清理本地已失效/不存在的幽灵路径（或 ad unlink -p）
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
