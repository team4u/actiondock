# 配置注入与多环境管理

业务 Action 通常需要访问令牌、数据库连接串或服务端点等凭据。
ActionDock 提供配置解析机制、敏感数据脱敏保护以及多环境 Profile 远程调度管理。

---

## 配置解析与五级回退优先级

执行 Action 读取配置时，ActionDock 按五级优先级判定配置值（从高到低）：

```text
命令行单次参数覆盖 (--config KEY=VALUE)
       │
       ▼
包级本地 SQLite 保存 (ad config set KEY VALUE)
       │
       ▼
操作系统环境变量与 .env 文件 (如 GITHUB_TOKEN)
       │
       ▼
全局持久化 SQLite 保存 (ad config set -g KEY VALUE)
       │
       ▼
actiondock.json 清单中的默认配置声明 (default)
```

---

## 注入配置的常用途径

### 命令行单次临时覆盖

适合临时调试或流水线动态注入。
该方式支持字符串与严格 JSON 解析：

```bash
# 字符串覆盖
ad run sample.greet -c GREETING_PREFIX="Bonjour" -- name=ActionDock

# 严格 JSON 对象覆盖（要求数值为有限数，不物化路径，解析错误退出码 2）
ad run sample.greet -c CONFIG_OBJ:='{"timeout":3000}' -- name=ActionDock
```

### 包级本地 SQLite 配置

在特定 Action Package 目录下执行，配置写入当前包的本地数据库。
写入执行全量替换与写前校验。
校验失败返回错误 `CONFIG_VALUE_INVALID`，原值保持不变：

```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx
```

写入命令格式为 `ad config set <key> [value] [options] [-- <assignments...>]`。
敏感字段可从环境变量读取，其余字段使用扁平赋值。
完整对象也可从文件读取，避免将密码写入命令：

```bash
printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root
ad config set MYSQL_191 --stdin < connection.json
```

- 位置值与扁平赋值：完整位置值在 `--` 前。合法 JSON 自动解码，否则作为字符串。`'a=b'` 视为普通字符串。仅 `--` 后识别扁平赋值。`=` 保留字符串，`:=` 严格解析 JSON。路径校验规则与 `ad run` 一致。
- 管道输入：`--stdin` 读取完整值并裁剪末尾空白，按 JSON 或字符串解码。空输入返回错误。`--stdin-field <field>` 将文本绑定为顶层字符串字段，保留全部空白且不解析 JSON。空输入为空字符串，可与扁平赋值组合。
- 模式互斥：完整位置值、`--stdin` 与结构化模式严格互斥。模式冲突或解析错误在读取或写入前以退出码 2 拒绝。管道输入限制与取消语义详见 [CLI 参考](../reference/cli.md#配置与状态管理)。
- 校验与加密：扁平赋值组装完整对象后再校验，不合并旧配置。缺少必填字段时失败并保留原值。字段绑定不改变敏感性判定。敏感键是否加密由声明与保存层决定。`ad state set` 写入的状态不加密也不脱敏，读取时可能显示原文。

### 全局跨包持久化配置

若希望某项凭据在所有 Action Package 中全局生效：

```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g
```

### 敏感配置静态加密

在清单中声明 `secret: true` 的配置键。
写入持久化库时，系统自动整键静态加密。
建议从环境变量管道注入或使用浏览器录入，避免在历史中留存令牌：

```bash
printf '%s' "$GITHUB_TOKEN" | ad config set GITHUB_TOKEN --stdin
printf '%s' "$GITHUB_TOKEN" | ad config set GITHUB_TOKEN --stdin -g
ad config set GITHUB_TOKEN --browser
```

早期版本明文保存的敏感配置无需手动迁移。
升级程序后首次打开配置库时，系统在写事务内自动加密敏感明文。
数据库同步升级至新结构。
若迁移失败则整体回滚并报告错误。
日常使用不受影响，`ad config set` 照常写入。
注意以下边界：

- 静态加密范围：系统保证敏感写入与迁移识别的敏感行以密文保存。系统不负责擦除旧页、历史 WAL、备份或快照中的明文。系统不自动创建备份。升级前应自行备份。
- 加密密钥管理：系统优先读取环境变量 `ACTIONDOCK_ENCRYPTION_KEY`。未配置时使用密钥文件 `~/.actiondock/keys/config.key`。首次加密时自动创建。应同时备份密钥文件与标记 `config.key.id`，并与数据库分开保存。密钥丢失后密文无法恢复。换用其他密钥会导致系统拒绝访问。
- 备份恢复流程：恢复前停止使用该目录的服务。将数据库文件与同名 `-wal` 及 `-shm` 文件统一归档，不可拆散。恢复时优先放置于全新数据目录，避免与旧 WAL 残留混用。再通过 `--data-dir` 指向该目录访问。
- 兼容与回退：恢复已加密数据库必须配套原密钥。旧版本明文备份仍含明文敏感值，须妥善保管。系统不提供明文导出接口。Action 内部可通过 `ctx.config.get` 读取明文。旧版本程序拒绝打开升级后的数据库，回退须使用旧版备份恢复。

### 操作系统环境变量与 .env 文件

在项目根目录下创建 `.env` 文件：

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

或直接通过系统环境变量传入：

```bash
GITHUB_TOKEN=ghp_xxxx ad run github.get-pr -- repo=team4u/actiondock prNumber:=1
```

---

## 常用配置管理命令速查

- 查看当前包配置声明与状态（通配模板单列并统计 matchCount，不判缺失）：
  ```bash
  ad config schema
  ```

- 列出当前配置项（安全脱敏视图，整项隐藏显示 `<hidden>`，未配置显示 `<not configured>`）：
  ```bash
  ad config list
  ad config list -g
  ```

- 读取配置项安全视图（系统不提供明文回显接口，也不提供明文查看参数）：
  ```bash
  ad config get GITHUB_TOKEN
  ad config get GITHUB_TOKEN -g
  ```

- 删除配置项（拒绝 `*` 通配符实键）：
  ```bash
  ad config delete GITHUB_TOKEN
  ad config delete GITHUB_TOKEN -g
  ```

---

## 多环境 Profile 远程调度机制

Profile 机制支持管理多个远端服务节点（如 staging、prod），实现跨环境远程执行：

### 添加远程环境节点

```bash
# 使用环境变量引用令牌（推荐，安全可控）
ad profile add prod --server https://actiondock.internal.company.com --token-env PROD_ACTIONDOCK_TOKEN

# 添加内网自签名 HTTPS 节点（传入 -k/--insecure 忽略证书校验）
ad profile add dev-box --server https://192.168.1.100:5177 --token secret-token-123 -k

# 使用固定 Token
ad profile add staging --server http://10.0.0.12:8080 --token secret-token-123
```

- 更新已有环境配置：
  ```bash
  # 为环境开启跳过证书合法性校验
  ad profile update dev-box -k

  # 为环境恢复强制严格证书校验
  ad profile update dev-box --no-insecure
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
# 在 staging 节点同步执行 Action（扁平参数规范调用）
ad run github.get-pr --profile staging -- repo=team4u/actiondock prNumber:=1

# 在远程节点发起异步长任务并获取运行标识
ad run heavy-data-sync --profile prod --async -- task=sync

# 追踪远程任务状态
ad runs show <runId> --profile prod

# 主动取消远程任务
ad runs cancel <runId> --profile prod --reason "手动中止任务"
```

---

## 项目级动作命名绑定与多环境路由

当项目需要跨节点调用远端能力或实现主备多环境调度时，可在调用方项目根目录下配置 `.actiondock/bindings.json`。

### 配置文件格式

```json
{
  "bindings": {
    "pricing/quote": {
      "primary": {
        "type": "remote",
        "profile": "office"
      },
      "fallback": {
        "type": "local"
      },
      "default": {
        "type": "local"
      }
    }
  }
}
```

### 路由判定与查找规则

- 未传绑定参数：Action 内部调用未传入 binding 选项时，系统仅查找配置中的 default 绑定。若未配置 default，则保持当前宿主的默认本地解析。
- 显式指定缺失绑定：若指定了 binding 却不存在对应条目，系统立即抛出 NOT_FOUND 错误。系统禁止隐式回退。
- 编程式覆盖配置：服务门面初始化时，可通过 `createActionDock` 的 `actionBindings` 选项在内存中覆盖绑定配置。

### 宿主装配与 Profile 生命周期

- 宿主装配时快照：配置规则与远程连接在宿主装配初始化时统一解析。系统创建快照保证连接确定性。
- 宿主环境语义：Profile 始终在执行 Action 的宿主环境上解析。配置目标 `type: "local"` 代表执行动作的宿主本身。
- 远端后续依赖解析：远端 Action 内部触发级联调用时，下游依赖依照远端宿主的环境与配置规则解析。

### 产物交付与部署规范

- 纯远端依赖无源码要求：路由至远端的 Action 无需本地实现，也无需加入 `actiondock.json` 的依赖项。若需本地备用实现，仍可安装本地依赖。
- 校验与构建识别：清单权限声明配合远端命名绑定，使 `ad validate` 与 `ad build` 准确识别外部依赖。
- 敏感配置隔离：打包时框架严禁将本地的 `.actiondock/bindings.json` 或 `profiles.json` 复制到交付产物中。
- 部署端现场配置：交付产物在生产环境执行前，部署端需在目标机器配置 Profile 与动作绑定。
- 业务显式降级：同一动作配置多个命名绑定仅提供调度凭据。框架不提供自动重试或隐式回退。更多实践参见 [动作命名绑定与路由机制](/developer/action-bindings.md)。
