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

## 连接目标

默认情况下，CLI 会连接本机服务：`http://127.0.0.1:5177`。本地开发或本机运行 `actiondock server` 时不需要先配置连接。

只有需要连接其他服务器、保存认证 Token，或频繁切换多个服务器时，才需要配置 profile。

```bash
# 创建带访问令牌的 profile（如果 API 启用了认证）
actiondock config add prod --server https://actiondock.example.com --token your-token-here

# 切换默认 profile
actiondock config use prod

# 查看当前 profile 配置
actiondock config show

# 临时使用其他 profile
actiondock script list --profile prod
```

### 环境变量方式

也可以通过环境变量临时指定连接目标：

```bash
export ACTIONDOCK_BASE_URL=http://localhost:5177
export ACTIONDOCK_TOKEN=your-token-here
export ACTIONDOCK_PROFILE=local
```

连接解析优先级：`--server` / `--token` > `--profile` > `ACTIONDOCK_BASE_URL` / `ACTIONDOCK_TOKEN` > `ACTIONDOCK_PROFILE` > 当前 profile > 默认 `http://127.0.0.1:5177`。

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

`--server`、`--token`、`--profile` 是 CLI 连接参数保留字，不会作为 Schema 动态字段传入；如果脚本输入字段同名，请使用 `--input-json` 或 `--input-file`。

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

### 服务器命令

```bash
actiondock server        # 前台启动服务
actiondock server -p 8080  # 指定端口启动
```

## 仓库命令

### 列出仓库

```bash
actiondock repository list
actiondock repository list --purpose capability
actiondock repository list --purpose project
```

`purpose` 用来区分仓库用途：

- `CAPABILITY`：分发脚本、插件、Skills、能力包
- `PROJECT`：指向业务项目代码库，并暴露项目知识入口

### 创建项目仓库

```bash
actiondock repository create \
  --repository-id billing-service \
  --name "Billing Service" \
  --type local-dir \
  --purpose project \
  --url /Users/code/projects/billing-service \
  --marker-path .actiondock/PROJECT.md
```

项目仓库支持：

- `--type git`
- `--type local-dir`

默认知识入口文件是 `.actiondock/PROJECT.md`。

### 解析项目知识入口

```bash
actiondock repository resolve --project billing-service
actiondock repository resolve --project billing-service --json
```

这个命令会：

1. 按仓库 ID 定位 `purpose=PROJECT` 的仓库
2. 对 `GIT` 类型先同步本地副本
3. 读取项目根目录下的 `PROJECT.md`
4. 返回项目根路径、marker 路径和原始 Markdown 内容

### 返回结果示例

```json
{
  "repositoryId": "billing-service",
  "type": "LOCAL_DIR",
  "purpose": "PROJECT",
  "root": "/Users/code/projects/billing-service",
  "markerPath": ".actiondock/PROJECT.md",
  "enabled": true,
  "exists": true,
  "content": "---\nproject_id: billing-service\n---\n\n# Billing Service\n..."
}
```

推荐用法：

1. 先读 `content`
2. 再按正文中描述的入口文件、目录和关键词去 `read` / `grep`
3. 只有在 Markdown 不足时再读源码

## 配置命令参考

```bash
actiondock config add <name> --server <url> [--token <token>]  # 创建或更新 profile
actiondock config use <name>                                   # 设置当前 profile
actiondock config list                                         # 列出 profiles
actiondock config show [--profile <name>]                      # 查看 profile 配置
actiondock config set server <url> [--profile <name>]          # 更新服务器地址
actiondock config set token <token> [--profile <name>]         # 更新访问令牌
actiondock config clear token [--profile <name>]               # 清除访问令牌
actiondock config remove <name>                                # 删除 profile
```

## 完整示例流程

```bash
# 1. 安装 CLI
npm install -g actiondock

# 2. 查看可用脚本（默认连接 http://127.0.0.1:5177）
actiondock script list

# 3. 查看脚本 Schema
actiondock script schema hello-groovy

# 4. 执行脚本
actiondock script run hello-groovy --name alice --json

# 5. 创建新脚本
cat > my-script.groovy << 'EOF'
return [greeting: "Hello, ${input.name}!", timestamp: System.currentTimeMillis()]
EOF

actiondock script create \
  --script-id my-script \
  --name "My Script" \
  --type groovy \
  --source-file my-script.groovy

# 6. 发布
actiondock script publish my-script

# 7. 执行验证
actiondock script run my-script --name alice --json

# 8. 解析项目仓库知识入口
actiondock repository resolve --project my-project --json
```

## 常见问题

### Q: actiondock: command not found

CLI 没有安装或不在 PATH 中。检查：
```bash
npm list -g actiondock
```

如果未安装：`npm install -g actiondock`

### Q: 连接失败

1. 检查 ActionDock 服务是否在运行：`actiondock script list`
2. 检查服务器地址配置：`actiondock config show`
3. 多 server 场景确认当前 profile：`actiondock config list`
4. 检查是否有网络防火墙拦截

### Q: Token 认证失败

1. 确认 Token 是否有效（在管理台检查令牌状态）
2. 确认当前 profile 的 Token 设置正确：`actiondock config set token <正确的 Token>`
3. 临时连接其他服务端时确认是否传了正确的 `--profile <name>`

---

> [返回目录](user-manual.md) | 下一步：查看 [API 参考与常见问题](api-reference.md)
