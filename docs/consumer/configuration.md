# 消费端配置与凭证注入

大多数业务 Action（如 GitHub 操作、数据库查询、第三方 API 请求）都需要诸如 API Token、数据库连接串或服务端点等凭证。

ActionDock 提供了灵活且安全的配置解析机制，并支持**示例降级机制**，使用者无需修改任何源码即可体验与注入配置。

---

## 开箱即用示例模式 vs 真实凭证

官方示例（如 `github-tools`）设计了优雅的模拟数据降级策略：
- **未配置 Token 时**：自动进入示例模式并输出警告日志，返回标准结构化的模拟数据（如示例 PR 列表），方便消费者快速验证调用链路。
- **配置 Token 后**：自动切换至请求真实的外部 API 服务。

---

## 探查必需配置 (`ad config schema`)

在开始使用某个 Action Package 前，可以先查看其声明了哪些配置项：

```bash
# 进入包目录探查
cd examples/github-tools
ad config schema
```

输出示例：
```text
Package: team4u.github-tools (v1.0.0)
Required Configurations:
  - GITHUB_TOKEN (string, secret): GitHub Personal Access Token [Status: MISSING (Fallback to Demo)]
  - GITHUB_API (string, default: "https://api.github.com"): GitHub API Base URL [Status: OK (Default)]
```

---

## 注入配置的常用途径

ActionDock 会按以下优先级（从高到低）自动解析配置：

```text
命令行临时覆盖 (--config)
       │
       ▼
项目本地 SQLite 存储 (ad config set)
       │
       ▼
操作系统环境变量 / .env 文件
       │
       ▼
全局 SQLite 存储 (ad config set -g)
       │
       ▼
Action 默认值 / 示例降级
```

### 全局配置（推荐，跨目录与跨项目通用）
如果某项凭证（如个人通用 GitHub Token）希望在所有跨目录调用的 ActionDock 包中生效：
```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g
```
> 全局配置安全保存在 `~/.actiondock/global.db` SQLite 数据库中。

### 项目本地 SQLite 配置
在特定 Action Package 目录下执行 `ad config set`，配置将安全存入当前项目目录下的 `.actiondock/runtime.db` 中（已被 `.gitignore` 忽略，绝不泄露到 Git）：

```bash
cd examples/github-tools
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx
```

### 使用 `.env` 文件或系统环境变量
在项目目录下创建 `.env` 文件：
```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```
或者在执行命令时直接作为系统环境变量传入：
```bash
GITHUB_TOKEN=ghp_xxxx ad run github-tools/github.list-prs --input '{"repo":"team4u/actiondock"}'
```

### 命令行单次临时覆盖
```bash
ad run github-tools/github.get-pr --config GITHUB_TOKEN=ghp_temp_token --input '{"repo":"team4u/actiondock","pullNumber":1}'
```

---

## 常用配置管理命令速查

```bash
# 列出当前项目配置项（默认掩码屏蔽敏感凭证）
ad config list

# 查看全局配置清单
ad config list -g

# 明文查看某个敏感配置值
ad config get GITHUB_TOKEN --reveal
ad config get GITHUB_TOKEN -g --reveal

# 删除已设置的配置
ad config delete GITHUB_TOKEN
ad config delete GITHUB_TOKEN -g
```
