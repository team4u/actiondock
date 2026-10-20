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

写入复杂或敏感对象时，推荐使用管道从标准输入传入，避免密钥残留于命令历史：

```bash
printf '%s' '{"host":"127.0.0.1","username":"root","password":"secret"}' | ad config set MYSQL_191 -P pkg --stdin
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

- 读取配置项安全视图（系统不提供明文回显接口，`--reveal` 仅向标准错误输出安全提示）：
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
