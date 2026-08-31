# 消费端配置与凭证注入 (Configuration Guide)

大多数业务 Action（如 GitHub 操作、数据库查询、第三方 API 请求）都需要诸如 API Token、数据库连接串或服务端点等敏感凭证。

ActionDock 提供了灵活且安全的 5 级配置解析机制，使用者无需修改任何源码即可注入配置。

---

## 1. 探查必需配置 (`ac config schema`)

在开始运行前，先查看当前包声明了哪些配置项以及当前是否已经满足：

```bash
ac config schema
```

输出示例：
```text
Package: github-tools (v1.0.0)
Required Configurations:
  - GITHUB_TOKEN (string, required): GitHub Personal Access Token [Status: MISSING ❌]
  - GITHUB_API_URL (string, optional, default: "https://api.github.com"): GitHub REST API Endpoint [Status: OK (Default) ✅]
```

---

## 2. 注入配置的 4 种常用途径

ActionDock 会按以下优先级（从高到低）自动解析配置：

```text
命令行临时覆盖 (--config)
       │
       ▼
项目本地 SQLite 存储 (ac config set)
       │
       ▼
操作系统环境变量 / .env 文件
       │
       ▼
全局 SQLite 存储 (ac config set -g)
       │
       ▼
Action 默认值
```

### 途径 A：存入项目本地 SQLite（最推荐，安全防泄露）
使用 `ac config set` 会将配置安全存入当前项目目录下的 `.actiondock/runtime.db` 中（该文件默认被 `.gitignore` 忽略，永不随 Git 提交）：

```bash
ac config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx
```

### 途径 B：使用 `.env` 文件或系统环境变量
在项目根目录下创建 `.env` 文件：
```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```
或者在执行命令时直接注入系统环境变量：
```bash
GITHUB_TOKEN=ghp_xxxx ac run github.get-pr --input '{"repo":"team4u/actiondock","prNumber":1}'
```

### 途径 C：全局配置（跨项目通用）
如果某项凭证（如通用的 GitHub Token）你希望在所有 ActionDock 项目中通用：
```bash
ac config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g
```
（全局配置安全保存在 `~/.actiondock/global.db` 中）

### 途径 D：命令行临时覆盖
```bash
ac run github.get-pr --config GITHUB_TOKEN=ghp_temp_token --input '{...}'
```

---

## 3. 常用配置管理命令速查

```bash
# 列出当前已设置的所有配置项（默认屏蔽敏感凭证）
ac config list

# 明文查看某个敏感配置值
ac config get GITHUB_TOKEN --reveal

# 删除已设置的配置
ac config delete GITHUB_TOKEN

# 管理全局配置时加上 -g
ac config list -g
ac config delete GITHUB_TOKEN -g
```
