# 配置注入与多环境管理

大多数业务 Action（如 GitHub 操作、数据库交互、第三方接口调用）都需要访问令牌、数据库连接串或服务端点等凭据。

ActionDock 提供了灵活且安全的配置解析机制、敏感数据脱敏保护以及多环境 Profile 远程调度管理。

---

## 配置解析与五级回退优先级

当执行 Action 读取配置时，ActionDock 按照确定的五级优先级判定配置值（从高到低）：

```text
命令行单次参数覆盖 (--config KEY=VALUE)
       │
       ▼
包级本地 SQLite 存储 (ad config set KEY VALUE)
       │
       ▼
操作系统环境变量与 .env 文件 (如 GITHUB_TOKEN)
       │
       ▼
全局持久化 SQLite 存储 (ad config set -g KEY VALUE)
       │
       ▼
actiondock.json 清单中的默认配置声明 (default)
```

---

## 注入配置的常用途径

### 命令行单次临时覆盖

适合临时调试或流水线动态注入：

```bash
ad run sample.greet --config GREETING_PREFIX="Bonjour" --input '{"name":"ActionDock"}'
```

### 包级本地 SQLite 配置

在特定 Action Package 目录下执行，配置存入当前包对应的本地数据库中：

```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx
```

### 全局跨包持久化配置

若希望某项凭证在所有 ActionDock 包中全局生效：

```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g
```

### 操作系统环境变量与 .env 文件

在项目根目录下创建 `.env` 文件：

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

或直接通过系统环境变量传入：

```bash
GITHUB_TOKEN=ghp_xxxx ad run github.get-pr --input '{"repo":"team4u/actiondock","prNumber":1}'
```

---

## 常用配置管理命令速查

- 查看当前包配置声明与状态：
  ```bash
  ad config schema
  ```

- 列出当前配置项（敏感值默认掩码遮蔽）：
  ```bash
  ad config list
  ad config list -g
  ```

- 明文读取敏感配置：
  ```bash
  ad config get GITHUB_TOKEN --reveal
  ad config get GITHUB_TOKEN -g --reveal
  ```

- 删除配置项：
  ```bash
  ad config delete GITHUB_TOKEN
  ad config delete GITHUB_TOKEN -g
  ```

---

## 多环境 Profile 远程调度机制

Profile 机制允许开发者在本地终端中无缝管理多个远端 ActionDock 服务节点（如 staging、prod），实现跨环境远程执行：

### 添加远程环境节点

```bash
# 使用环境变量引用令牌（推荐，安全可控）
ad profile add prod --server https://actiondock.internal.company.com --token-env PROD_ACTIONDOCK_TOKEN

# 使用固定 Token
ad profile add staging --server http://10.0.0.12:8080 --token secret-token-123
```

### 管理与切换环境

- 列出所有已配置的远程环境：
  ```bash
  ad profile list
  ```

- 切换默认环境：
  ```bash
  ad profile use staging

  # 切换回本地执行模式
  ad profile use local
  ```

- 探测远程节点连通性：
  ```bash
  ad profile test staging
  ```

- 删除指定环境节点：
  ```bash
  ad profile remove old-env
  ```

### 跨节点远程执行与异步追踪

在执行命令时传入 `--profile` 或 `--server` 参数，CLI 会自动将请求转发给远端 `ad serve` 节点执行：

```bash
# 在 staging 节点同步执行 Action
ad run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}' --profile staging

# 在远程节点发起异步长任务并获取运行标识
ad run heavy-data-sync --input-file ./params.json --profile prod --async

# 追踪远程任务状态
ad runs show <runId> --profile prod

# 主动取消远程任务
ad runs cancel <runId> --profile prod --reason "手动中止任务"
```
