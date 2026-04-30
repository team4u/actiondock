# @actiondock/server

**`@actiondock/server`** 是 ActionDock 的官方服务端发行包。

它把脚本运行、管理台、REST API、仓库分发、插件调用、共享状态和 AI 能力放进同一个可直接启动的服务里，让一套脚本同时被人、HTTP 客户端、CLI 和 Agent 使用。

一句话概括：

> **把零散脚本升级成可发布、可复用、可审计、可被 AI 稳定调用的服务端运行平台。**

## 适合谁

如果你遇到的是下面这类问题，这个包就是给你用的：

- 团队里已经有很多内部脚本，但分散在个人目录、机器人、Cron、Jenkins 或各种仓库里
- 想把脚本统一收进一个带输入输出契约的运行平台，而不是继续靠 README 和口头约定
- 想给外部系统、CLI 或 AI Agent 提供稳定的内部工具调用入口
- 需要给脚本补上发布、依赖、分发、配置、共享状态、日志和审计能力

## 核心能力

- **脚本资产化**：支持 `GROOVY` 和 `PYTHON` 脚本，带 `inputSchema` / `outputSchema`、草稿、发布快照、执行记录和调试视图。
- **多入口复用**：同一份脚本可被管理台、REST API、CLI 和 Agent 共用。
- **仓库化分发**：支持脚本、插件、AI 能力包的仓库发现、安装、更新、开发同步和再次发布。
- **插件扩展**：Groovy / Python 脚本统一通过 `plugins.invoke(...)` 调用插件动作。
- **AI 原生能力**：管理模型、Agent、Toolset，并支持脚本生成、修复、诊断、发布辅助等场景。
- **共享状态与配置治理**：内建配置值、共享状态、访问令牌、定时任务、备份恢复。
- **调用命令与 Skill 示例生成**：管理台可基于当前脚本或插件动作，自动生成可直接执行的 HTTP / CLI 调用命令，也能进一步生成适合 Agent / Codex 复用的 skill 示例，减少二次手写。

## 快速开始

### 安装

```bash
npm i -g @actiondock/server
```

### 启动

```bash
actiondock-server
```

默认端口是 `5177`，且仅允许本机访问（绑定 `127.0.0.1`）。如需对外部网络开放，可通过以下方式修改绑定地址：

```bash
# 启动时传入参数
actiondock-server --server.address=0.0.0.0

# 或设置环境变量
SERVER_ADDRESS=0.0.0.0 actiondock-server
```

启动后常用入口：

- 管理台：`http://localhost:5177/admin/app/scripts`
- API 根路径：`http://localhost:5177/api`
- Swagger UI：`http://localhost:5177/swagger-ui.html`

### 最小验证

服务默认会初始化示例脚本 `hello-groovy`。可直接调用：

```bash
curl -X POST http://localhost:5177/api/scripts/hello-groovy/published/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "name": "alice"
    },
    "mode": "SYNC"
  }'
```

如果你同时安装了 CLI，也可以直接执行：

```bash
actiondock script run hello-groovy --name alice --json
```

## 安装要求

- JDK 21+
- Python 3.x

说明：

- `PYTHON` 类型脚本默认使用宿主机里的 `python3`
- 通过 jDeploy 桌面安装包启动时，ActionDock 会启动本机服务并自动打开管理台

## 这个包里有什么

这是一个完整可运行的服务端分发包，包含：

- Spring Boot Web 服务
- ActionDock 管理台静态资源
- 脚本、插件、仓库、执行、共享状态、AI 等 REST API
- jDeploy 打包与更新能力

它对应仓库里的 `actiondock-app-spring` 模块，但公网用户通常只需要关心“安装后如何启动和使用”，不需要先理解整个多模块结构。

## 常见使用方式

### 1. 直接启动

```bash
actiondock-server
```

适合个人使用、开发环境和快速试跑。

### 2. 更新到新版本

```bash
actiondock-server update
```

如需使用 npm 方式升级，也可以：

```bash
npm i -g @actiondock/server@latest
```

启动后服务会低频检查 npm 上是否有新版本，并在日志里输出升级提示。可通过环境变量 `ACTIONDOCK_NO_UPDATE_NOTIFIER=1` 关闭提醒。

### 3. 桌面版启动

jDeploy 原生桌面安装包会提供桌面入口。双击启动后，ActionDock 会：

- 启动或复用本机 `5177` 端口上的 ActionDock 服务
- 自动打开默认浏览器到管理台
- 在系统托盘提供 `Open Admin Console` 和 `Quit ActionDock`

桌面版不再安装或管理系统服务；如果需要命令行常驻运行，直接执行 `actiondock-server`。

## 公开接口概览

常用 API 分组如下：

| 路径前缀 | 说明 |
|----------|------|
| `/api/scripts` | 脚本管理、发布、Fork、开发同步 |
| `/api/executions` | 脚本执行与执行记录 |
| `/api/plugins` | 插件管理、配置与动作调用 |
| `/api/repositories` | 仓库、仓库工具、仓库插件、AI 能力包 |
| `/api/schedules` | 全局定时任务管理 |
| `/api/scripts/{scriptId}/schedules` | 脚本级定时任务管理 |
| `/api/config-values` | 配置值管理 |
| `/api/shared-state` | 共享状态管理 |
| `/api/access-tokens` | 访问令牌管理 |
| `/api/ai` | 模型、Agent、Toolset、AI Tool、Agent Run、调用日志 |
| `/api/schema` | 脚本输入输出 Schema 摘要 |
| `/api/installed-tools` | 已安装仓库工具卸载入口 |

如果系统里配置了访问令牌，调用 `/api/*` 时需要带：

```text
Authorization: Bearer <token>
```

## 共享状态

共享状态适合保存 OAuth Token、同步游标、水位线、批次号等跨脚本复用的数据。它不是某个单一业务功能，而是通用运行时状态存储。

核心字段：

- `namespace`
- `key`
- `value`：任意 JSON
- `secret`
- `expiresAt`
- `version`

写入示例：

```bash
curl -X POST http://localhost:5177/api/shared-state \
  -H 'Content-Type: application/json' \
  -d '{
    "namespace": "oauth.github",
    "key": "access-token",
    "value": {
      "accessToken": "gho_xxx",
      "tokenType": "Bearer"
    },
    "secret": true,
    "expiresAt": "2026-04-28T12:00:00"
  }'
```

它支持 CAS 更新、按命名空间查询和过期清理，适合做脚本之间的轻量共享状态层。

## 调用命令与 Skill 示例

管理台里的脚本页和插件页都可以直接生成：

- 可执行的 HTTP 调用命令
- 可执行的 CLI 调用命令
- 基于当前调用命令整理出的 skill 示例

这个能力适合：

- 给同事复制一条可直接运行的命令
- 给 Agent / Codex 提供稳定调用模板
- 把当前页面的测试入参、执行模式、Schema 上下文一起带进 skill 示例

相比手写说明文档，它的好处是命令和页面当前状态保持一致，减少“文档写的是一套，实际调用又是另一套”的偏差。

## 本地开发

如果你是在仓库里开发这个子项目，而不是作为 npm 用户使用：

```bash
# 启动后端
mvn -pl actiondock-app-spring -am spring-boot:run

# 启动前端开发服务器
cd ../actiondock-admin-ui
npm install
npm run dev
```

开发时常用地址：

- 前端开发地址：`http://localhost:5173/admin/app/scripts`
- 后端管理台地址：`http://localhost:5177/admin/app/scripts`

## 发布前自检

在本目录可执行：

```bash
npm install
npm run pack:dry-run
```

`pack:dry-run` 会先构建 Spring Boot jar，再生成 `jdeploy-bundle/`，最后校验 npm 包内容。

## 发布

### npm 包

```bash
cd actiondock-app-spring
npm run pack:dry-run
npm publish --access public
```

用户安装：

```bash
npm i -g @actiondock/server
actiondock-server
```

### 桌面安装包

仓库根目录的 `.github/workflows/jdeploy.yml` 会在发布 GitHub Release 或推送 `v*` tag 时构建并上传桌面安装包：

```bash
gh release create v0.3.5 --target main --title "v0.3.5" --notes "ActionDock desktop release"
```

用户从 GitHub Releases 下载对应平台安装包。安装后双击 `ActionDock`，会启动或复用本机服务、打开管理台，并提供托盘入口。
