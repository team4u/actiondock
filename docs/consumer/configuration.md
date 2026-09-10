# 消费端配置与凭证注入

大多数业务 Action（如 GitHub 操作、数据库查询、第三方接口调用）都需要诸如访问令牌、数据库连接串或服务端点等凭证。

ActionDock 提供了灵活且安全的配置解析机制，并支持示例降级机制，使用者无需修改任何源码即可体验与注入配置。

---

## 示例模式与真实凭证

官方示例设计了优雅的数据降级策略：
- 未配置令牌时：自动进入示例模式并输出警告日志，返回标准结构化的模拟数据（如示例 PR 列表），方便消费者快速验证调用链路。
- 配置令牌后：自动切换至请求真实的外部服务接口。

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
Package: team4u.github-tools (v2.0.0)
Required Configurations:
  - GITHUB_TOKEN (string, secret): GitHub 个人访问令牌 [Status: MISSING (Fallback to Demo)]
  - API_BASE (string, default: "https://api.github.com"): GitHub API 根地址 [Status: OK (Default)]
```

---

## 注入配置的常用途径

ActionDock 会按以下优先级（从高到低）自动解析配置：

```text
命令行单次参数覆盖 (--config KEY=VALUE)
       │
       ▼
项目包级 SQLite 存储 (ad config set KEY VALUE)
       │
       ▼
操作系统环境变量与环境配置文件 (.env)
       │
       ▼
全局 SQLite 存储 (ad config set -g KEY VALUE)
       │
       ▼
actiondock.json 默认配置声明 / 示例降级
```

### 全局配置（跨目录与跨项目通用）
如果某项凭证希望在所有跨目录调用的 ActionDock 包中生效：
```bash
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g
```

### 包级本地 SQLite 配置
在特定 Action Package 目录下执行 `ad config set`，配置将存入当前包对应的持久化数据库中：

```bash
cd examples/github-tools
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx
```

### 操作系统环境变量与环境文件
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
# 列出当前项目配置项（默认掩码屏蔽敏感凭据）
ad config list

# 查看全局配置清单
ad config list -g

# 包含敏感配置明文查看
ad config get GITHUB_TOKEN --reveal
ad config get GITHUB_TOKEN -g --reveal

# 删除已设置的配置项
ad config delete GITHUB_TOKEN
ad config delete GITHUB_TOKEN -g
```

---

## 清单配置声明格式

在 `actiondock.json` 中声明配置规范：

```json
{
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "config": {
    "GITHUB_TOKEN": {
      "type": "string",
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "required": true,
      "env": "GITHUB_TOKEN"
    },
    "API_BASE": {
      "type": "string",
      "description": "GitHub API 根地址",
      "default": "https://api.github.com"
    }
  }
}
```
