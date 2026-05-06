# CLI 参考

## 一句话理解

ActionDock CLI 是基于 oclif 的 TypeScript 命令行工具。它连接到 ActionDock 服务端，让你在终端中执行脚本、管理服务、查看 Schema。CLI 自动将脚本的 `inputSchema` 展平为 `--param value` 形式的命令行 flag。

## 安装

```bash
npm install -g actiondock
```

验证安装：

```bash
actiondock --version
# 输出: actiondock/<version>
```

## 配置

### 配置服务器地址

```bash
# 设置服务器地址
actiondock config set server http://localhost:5177

# 设置访问令牌（如果 API 启用了认证）
actiondock config set token your-token-here

# 查看当前配置
actiondock config show
```

### 环境变量方式

除了 `config set`，也可以通过环境变量配置：

```bash
export ACTIONDOCK_BASE_URL=http://localhost:5177
export ACTIONDOCK_TOKEN=your-token-here
```

环境变量优先级高于配置文件设置。

## 脚本命令

### 查看脚本列表

```bash
# 列出所有可用的脚本
actiondock script list

# 显示所有状态（含草稿等）
actiondock script list --all
```

### 查看 Schema

```bash
# 查看脚本的 inputSchema 和 outputSchema
actiondock script schema <script-id>
```

输出示例：

```json
{
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "default": "world" }
    }
  }
}
```

### 执行脚本

```bash
# 基本执行
actiondock script run <script-id> --name alice --json

# 执行草稿版本
actiondock script run <script-id> --draft --name alice --json

# 以 debug 视图查看执行（含输入、日志、错误详情）
actiondock script run <script-id> --response-view debug --name alice

# 复杂参数使用 --input-json 传入
actiondock script run <script-id> --input-json '{"name": "alice", "tags": ["a", "b"]}'
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| `--json` | 输出格式化为 JSON |
| `--draft` | 执行草稿版本而非已发布版本 |
| `--response-view debug` | 显示调试视图（含日志、输入、错误详情） |
| `--input-json` | 以 JSON 字符串传入复杂参数 |
| `--<field-name>` | Schema 中展平的字段直接作为 flag |

### Schema 驱动的 CLI 参数

对于简单类型字段（string、integer、number、boolean），CLI 自动展平：

```bash
# 如果 Schema 定义了:
# - name (string, required)
# - age (integer)
# - enabled (boolean)

actiondock script run my-script --name alice --age 30 --enabled --json
```

对象和数组类型不能展平，需要使用 `--input-json`：

```bash
actiondock script run my-script --input-json '{"name": "alice", "metadata": {"source": "web"}}'
```

### 创建脚本

```bash
actiondock script create \
  --script-id my-new-script \
  --name "My Script" \
  --type groovy \
  --source-file ./script.groovy
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--script-id` | 是 | 脚本唯一标识 |
| `--name` | 是 | 人类可读名称 |
| `--type` | 是 | `groovy` 或 `python` |
| `--source-file` | 是 | 脚本源码文件路径 |

### 更新脚本

```bash
# 更新源码
actiondock script patch <id> --source-file ./new-source.groovy

# 更新其他字段
actiondock script patch <id> --name "New Name"
```

`patch` 命令支持 JSON Merge Patch (RFC 7396) 部分更新。

### 校验和发布

```bash
# 校验脚本语法
actiondock script validate <id>

# 发布脚本（产生不可变快照）
actiondock script publish <id>
```

## 服务管理

### 桌面模式

```bash
actiondock desktop
# 启动服务并打开管理台浏览器窗口
# 系统托盘图标显示运行状态
```

### 服务器命令

```bash
actiondock server        # 前台启动服务
actiondock server -p 8080  # 指定端口启动
```

### 系统服务管理（Windows/Linux）

```bash
actiondock service install   # 安装为系统服务（开机自启）
actiondock service start     # 启动服务
actiondock service status    # 查看服务状态
actiondock service stop      # 停止服务
actiondock service restart   # 重启服务
actiondock service uninstall # 卸载系统服务
```

## 配置命令参考

```bash
actiondock config set server <url>       # 设置服务器地址
actiondock config set token <token>     # 设置访问令牌
actiondock config show                  # 查看当前配置
actiondock config reset                 # 重置配置
```

## 完整示例流程

```bash
# 1. 安装 CLI
npm install -g actiondock

# 2. 配置服务器
actiondock config set server http://localhost:5177

# 3. 查看可用脚本
actiondock script list

# 4. 查看脚本 Schema
actiondock script schema hello-groovy

# 5. 执行脚本
actiondock script run hello-groovy --name alice --json

# 6. 创建新脚本
cat > my-script.groovy << 'EOF'
return [greeting: "Hello, ${input.name}!", timestamp: System.currentTimeMillis()]
EOF

actiondock script create \
  --script-id my-script \
  --name "My Script" \
  --type groovy \
  --source-file my-script.groovy

# 7. 发布
actiondock script publish my-script

# 8. 执行验证
actiondock script run my-script --name alice --json
```

## 常见问题

### Q: actiondock: command not found

CLI 没有安装或不在 PATH 中。检查：
```bash
npm list -g actiondock
```

如果未安装：`npm install -g actiondock`

### Q: 连接失败

1. 检查 ActionDock 服务是否在运行：`actiondock service status`
2. 检查服务器地址配置：`actiondock config show`
3. 检查是否有网络防火墙拦截

### Q: Token 认证失败

1. 确认 Token 是否有效（在管理台检查令牌状态）
2. 确认 Token 设置正确：`actiondock config set token <正确的 Token>`

---

> [返回目录](user-manual.md) | 下一步：查看 [API 参考与常见问题](api-reference.md)
