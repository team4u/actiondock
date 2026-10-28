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

适合临时调试或流水线动态注入，支持字符串与严格 JSON 解析：

```bash
# 字符串覆盖
ad run sample.greet -c GREETING_PREFIX="Bonjour" -- name=ActionDock

# 严格 JSON 对象覆盖（要求数值为有限数，不物化路径，解析错误退出码 2）
ad run sample.greet -c CONFIG_OBJ:='{"timeout":3000}' -- name=ActionDock
```

### 包级本地 SQLite 配置

在特定 Action Package 目录下执行，配置存入当前包对应的本地数据库中（写入执行全量替换与写前校验，失败报 `CONFIG_VALUE_INVALID` 且原值不变）：

```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx
```

写入命令形态为 `ad config set <key> [value] [options] [-- <assignments...>]`。敏感字段可从已有环境变量读取，其他字段使用扁平赋值；完整对象也可从受控文件读取，避免把真实密码直接写入命令文本：

```bash
printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root
ad config set MYSQL_191 --stdin < connection.json
```

- 完整位置值在 `--` 前，合法 JSON 自动解码（支持根数组与标量），否则作为字符串；`'a=b'` 不会被猜成扁平赋值。仅 `--` 后识别扁平赋值，`=` 保留字符串，`:=` 严格解析 JSON，支持点路径与连续数组，检查规则与 `ad run` 一致。
- `--stdin` 读取完整值，裁剪末尾 CR/LF，按 JSON 或普通字符串解码，空输入报错；`--stdin-field <field>` 将原始文本绑定顶层字符串字段，保留 BOM、换行与全部空白，不解析 JSON，空输入为空字符串，可与扁平赋值组合。
- 完整位置值、`--stdin`、结构化模式（扁平赋值及字段绑定）互斥；模式冲突、赋值解析与路径错误在读取 stdin 或写入前以退出码 2 拒绝。管道输入沿用大小上限与取消语义，详见 [CLI 参考](../reference/cli.md#配置与状态管理)。
- 扁平赋值同样先组装完整对象再按模式校验，不会合并旧配置；缺少密码等必填字段时失败并保留原值。字段绑定只改变输入渠道，不改变敏感性判定，敏感键是否加密由声明与存储层决定；同语法的 `ad state set` 写入的状态不加密也不脱敏，状态读取可能显示原文。

### 全局跨包持久化配置

若希望某项凭证在所有 ActionDock 包中全局生效：

```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g
```

### 敏感配置静态加密

在清单中声明 `secret: true`（含内嵌模式字段级敏感）的配置键，写入包级或全局持久化库时自动整键静态加密，无需额外操作。避免把真实令牌写入命令文本与 shell 历史，优先从已有环境变量管道注入或使用浏览器录入：

```bash
printf '%s' "$GITHUB_TOKEN" | ad config set GITHUB_TOKEN --stdin
printf '%s' "$GITHUB_TOKEN" | ad config set GITHUB_TOKEN --stdin -g
ad config set GITHUB_TOKEN --browser
```

早期版本以明文保存的敏感配置不需要任何迁移命令：升级程序后首次打开配置库时，系统在同一个写事务内自动把存量敏感明文加密并把数据库升级到当前结构，失败整体回滚并明确报错；正常使用即可，`ad config set` 也照常写入。注意以下边界：

- 静态加密保证敏感写入及自动迁移识别出的敏感行以密文保存，不承诺擦除数据库旧页、历史 WAL、既有备份、文件系统快照或底层物理介质中的历史明文副本；系统不自动创建备份，需要回退保障时请在升级前自行备份并妥善保管。
- 加密密钥优先取环境变量 `ACTIONDOCK_ENCRYPTION_KEY`，否则使用密钥文件（默认 `~/.actiondock/keys/config.key`，`--data-dir` 时为 `<dataDir>/keys/config.key`）。首次需要加密时自动生成；应同时备份密钥文件及身份标记 `config.key.id`，并与数据库备份分开安全保存。密钥丢失后密文无法恢复，换用另一把密钥会被拒绝。
- 备份恢复流程：恢复前先停止使用该数据目录的所有相关服务；将当前数据库文件与其同名的 `-wal`、`-shm` 文件作为一个完整集合一起移动归档，不要拆散混用。优先把备份恢复到全新的数据目录：按目标包 `<dataDir>/<package-id>/runtime.db` 或全局 `<dataDir>/global.db` 的布局放置备份文件，再通过 `--data-dir` 指向该目录访问，避免备份与旧 WAL/SHM 残留混用。
- 恢复已加密数据库时必须配套原密钥（密钥文件与其身份标记需与数据库备份分别安全保存）才能读取；迁移前的 v2 明文备份可在旧版本程序直接打开，无需解密密钥，其中仍含明文敏感值，须按敏感数据妥善保管。系统不提供管理端明文导出接口，需要明文时在恢复后的库上通过 Action 内 `ctx.config.get` 读取；旧版本程序只接受 v2，会直接拒绝打开已升级为 v3 的数据库，回退须用自行保留的 v2 备份库恢复。

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

Profile 机制允许开发者在本地终端中无缝管理多个远端 ActionDock 服务节点（如 staging、prod），实现跨环境远程执行：

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

- 未传绑定参数：当 Action 内部调用未传入 binding 选项时，系统仅查找配置中的 default 绑定；若未配置 default，则保持当前宿主的默认本地解析。
- 显式指定缺失绑定：若调用显式指定了 binding（如 `{ binding: "primary" }`），但绑定配置中不存在该条目，系统立即抛出 NOT_FOUND 错误，严禁隐式回退。
- 编程式覆盖配置：在通过服务门面初始化时，可通过 `createActionDock({ actionBindings: { [callerPackageId]: ActionBindings } })` 选项在内存中直接覆盖指定调用方包的绑定文件。

### 宿主装配与 Profile 生命周期

- 宿主装配时快照：配置规则与 Profile 远程连接在 Host 装配初始化时统一解析并生成快照，保证运行期间的连接确定性。
- 宿主环境语义：Profile 始终在执行该 Action 的宿主环境上进行解析；配置目标 `type: "local"` 代表执行该动作的宿主本身，绝非发起 CLI 命令的客户端计算机。
- 远端后续依赖解析：远端 Action 内部触发的级联调用，其下游依赖完全依托远端宿主所在的环境与配置规则进行解析。

### 产物交付与部署规范

- 纯远端依赖无源码要求：仅路由至远端的 Action 无需本地实现，也无需加入 `actiondock.json` 的 `dependencies`；若需本地备用实现，仍可正常安装本地依赖。
- 校验与构建识别：清单中的 uses 权限声明配合 `.actiondock/bindings.json` 中的远端命名绑定，可使 `ad validate` 与 `ad build` 准确识别跨节点外部依赖。
- 敏感配置与产物物理隔离：执行 `ad build` 或 `ad pack` 打包时，框架严禁将开发机本地的 `.actiondock/bindings.json` 或包含密钥的 `profiles.json` 复制到交付产物中。
- 部署端现场配置：交付产物在目标生产环境运行前，部署端必须在目标机器上重新配置现场的 Profile 节点与动作绑定。
- 业务显式降级：同一完全限定动作配置多个命名绑定仅为业务层提供调度凭据，框架不提供静默的自动重试或隐式回退。更多端到端开发与异常降级实践参见 [动作命名绑定与路由机制](/developer/action-bindings.md)。
