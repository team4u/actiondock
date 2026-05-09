# 脚本日常执行

查找和运行已发布的 ActionDock 脚本。只覆盖 `script` 和 `config` 命令。

其他管理命令见独立子文档：
- 插件查看与调用 → `references/plugin-usage.md`
- 执行历史管理 → `references/execution-history.md`
- 定时任务管理 → `references/schedule-management.md`
- 共享状态管理 → `references/state-management.md`

---

## 连接目标

默认情况下，CLI 会连接本机服务：`http://127.0.0.1:5177`。本地开发或本机运行 `actiondock server` 时，不需要先配置连接。

只有需要连接其他服务器、保存认证 Token，或频繁切换多个服务器时，才创建 profile：

```bash
actiondock config add prod --server https://your-server.example.com --token your-bearer-token
actiondock config use prod
```

查看当前 profile 配置：

```bash
actiondock config show
```

如果需要频繁访问多个服务端，为每个服务端创建一个 profile：

```bash
actiondock config add staging --server https://staging.example.com --token staging-token
actiondock config list
actiondock script list --profile staging
```

连接解析优先级：`--server` / `--token` > `--profile` > `ACTIONDOCK_BASE_URL` / `ACTIONDOCK_TOKEN` > `ACTIONDOCK_PROFILE` > 当前 profile > 默认 `http://127.0.0.1:5177`。

| 环境变量 | 说明 |
|----------|------|
| `ACTIONDOCK_BASE_URL` | 服务地址 |
| `ACTIONDOCK_TOKEN` | Bearer Token |
| `ACTIONDOCK_PROFILE` | 默认使用的 profile 名称 |

配置文件位置：
- Windows: `%APPDATA%\actiondock\config.json`
- macOS: `~/Library/Application Support/actiondock/config.json`
- Linux: `~/.config/actiondock/config.json`

| 命令 | 说明 |
|------|------|
| `actiondock config add <name> --server <url> [--token <token>]` | 创建或更新 profile |
| `actiondock config use <name>` | 设置当前 profile |
| `actiondock config list` | 列出 profiles |
| `actiondock config show [--profile <name>]` | 查看当前或指定 profile |
| `actiondock config set server <url> [--profile <name>]` | 更新 profile 服务地址 |
| `actiondock config set token <token> [--profile <name>]` | 更新 profile 认证 Token |
| `actiondock config clear token [--profile <name>]` | 清除 profile Token |
| `actiondock config remove <name>` | 删除 profile |

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

`--server`、`--token`、`--profile` 是连接参数保留字，不会作为动态输入字段传入；如果脚本输入字段同名，使用 `--input-json` / `--input-file`。

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

## 3. 执行失败时怎么判断

如果执行返回失败，优先看这些字段：

- `status`
- `errorMessage`
- `errorDetail.stackTrace`
- `errorDetail.details.code`
- `logs`

如果是异步执行，先拿到 execution ID，再用：

```bash
actiondock execution get <execution-id> --json
```

### 常见 Python 失败码

如果目标脚本是 Python，`errorDetail.details.code` 可能出现以下值：

- `PYTHON_RUNTIME_MISSING`
- `PYTHON_ENV_PREPARE_FAILED`
- `PYTHON_DEP_INSTALL_FAILED`
- `PYTHON_EXECUTION_FAILED`

判读建议：

- `PYTHON_RUNTIME_MISSING`
  - 说明宿主 Python 运行环境不可用
  - 优先判断服务端是否缺少 `python3`

- `PYTHON_ENV_PREPARE_FAILED`
  - 说明虚拟环境准备失败
  - 优先判断服务端是否缺少 `python3 -m venv` 能力，而不是先怀疑脚本业务逻辑

- `PYTHON_DEP_INSTALL_FAILED`
  - 说明脚本声明的第三方依赖安装失败
  - 优先回到作者态流程检查 `pythonRequirements` / `requirements.txt`
  - 不要先改业务代码

- `PYTHON_EXECUTION_FAILED`
  - 说明依赖已准备完成，但 Python 脚本本身运行失败
  - 这时再结合 `errorMessage`、`stackTrace`、`logs` 判断代码问题

### 处理原则

- 输入不合法：先修输入，不要先改脚本
- Python 环境/依赖失败：先修运行环境或 `pythonRequirements`
- 脚本逻辑失败：再回作者态修源码
- 输出结构不对：回作者态同时核对源码和 `outputSchema`

---

## 4. 典型工作流

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
