# 脚本日常执行

查找和运行已发布的 ActionDock 脚本。只覆盖 `script` 和 `config` 命令。

其他管理命令见独立子文档：
- 插件查看与调用 → `references/plugin-usage.md`
- 执行历史管理 → `references/execution-history.md`
- 定时任务管理 → `references/schedule-management.md`
- 共享状态管理 → `references/state-management.md`

---

## 首次使用：配置连接

```bash
actiondock config set server https://your-server.example.com
actiondock config set token your-bearer-token
```

查看当前配置：

```bash
actiondock config show
```

配置也可通过环境变量覆盖，优先级：命令行 flag > 环境变量 > 本地配置文件。

| 环境变量 | 说明 |
|----------|------|
| `ACTIONDOCK_BASE_URL` | 服务地址 |
| `ACTIONDOCK_TOKEN` | Bearer Token |

配置文件位置：
- Windows: `%APPDATA%\actiondock-cli\config.json`
- macOS: `~/Library/Application Support/actiondock-cli/config.json`
- Linux: `~/.config/actiondock-cli/config.json`

| 命令 | 说明 |
|------|------|
| `actiondock config set server <url>` | 保存服务地址 |
| `actiondock config set token <token>` | 保存认证 Token |
| `actiondock config show` | 查看当前配置 |
| `actiondock config clear server` | 清除服务地址 |
| `actiondock config clear token` | 清除 Token |

---

## 1. 查找脚本

### 列出已发布脚本

```bash
actiondock script list
```

默认只列出有已发布快照的脚本。加 `--all` 可包含仅有草稿的脚本。

输出格式：`<id> <name> [<type>] published|draft-only`

### 查看脚本输入参数

```bash
actiondock script schema <script-id>
```

输出两类字段：
- **Flag fields**：可用 `--name value` 形式传入的简单类型（string/number/integer/boolean/enum）
- **JSON-only fields**：只能通过 `--input-json` / `--input-file` 传入的复杂类型（object/array）

加 `--draft` 查看草稿版本的 schema。

### 查看脚本完整定义

```bash
actiondock script get <script-id>
```

加 `--draft` 查看草稿版本。

---

## 2. 执行脚本

### 推荐方式：写入临时文件后再执行

当输入参数包含 JSON 对象、数组等复杂结构时，**优先将输入写入临时 JSON 文件，再用 `--input-file` 传参**，避免 shell 转义问题。

```bash
# 1. 将输入参数写入临时文件
echo '{"name":"alice","config":{"timeout":30}}' > /tmp/my-script-input.json

# 2. 用文件传参执行
actiondock script run <script-id> --input-file /tmp/my-script-input.json
```

简单字段（string/number/integer/boolean/enum）可单独用 flag 传参，无需写文件：

```bash
actiondock script run <script-id> --name alice --count 3
```

### 混合传参

`--input-file` 提供基础输入对象，动态 flag 会合并进去并覆盖同名字段：

```bash
actiondock script run <script-id> \
  --input-file /tmp/base-input.json \
  --name override-value
```

### 直接 JSON 传参（仅适合简单场景）

输入非常简单时可内联 JSON，但容易遇到 shell 转义问题，不推荐用于复杂输入：

```bash
actiondock script run <script-id> \
  --input-json '{"name":"alice","config":{"timeout":30}}'
```

### 异步执行

长时间运行的脚本，使用异步模式提交后通过 execution ID 查询结果：

```bash
actiondock script run <script-id> --mode async --name alice
```

返回结果中包含 `id`（execution ID），后续用 `execution get` 查询（见 `references/execution-history.md`）。

### 执行草稿版本（调试）

加 `--draft` 执行草稿而非已发布版本：

```bash
actiondock script run <script-id> --draft --name alice
```

### 查看调试信息

加 `--response-view debug` 获取 debug 信息（含原始 input 和 rawOutput）：

```bash
actiondock script run <script-id> --response-view debug --name alice
```

### 输入类型自动转换

动态 flag 的值会根据 `inputSchema` 自动转换：
- `--count 3` → schema 定义为 integer 时自动转为数字
- `--enabled true` → schema 定义为 boolean 时自动转为布尔值
- `--mode fast` → schema 定义为 enum 时保持字符串

---

## 3. 典型工作流

### 执行已知脚本

```bash
actiondock script schema my-script
actiondock script run my-script --name alice --count 3
```

### 查找并执行陌生脚本

```bash
actiondock script list
actiondock script schema target-script
actiondock script run target-script --param1 value1
```

### 复杂输入执行

```bash
actiondock script schema my-script
echo '{"name":"alice","config":{"timeout":30}}' > /tmp/input.json
actiondock script run my-script --input-file /tmp/input.json
```

### 长时间脚本异步执行

```bash
actiondock script run heavy-script --mode async --input-file ./input.json
# 后续查看结果 → 见 references/execution-history.md
```
