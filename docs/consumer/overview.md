# 消费与接入总览

作为 ActionDock 框架的使用者，通常需要将现有的 Action 能力、规程或交付产物接入到具体的运行环境中。ActionDock 提供了覆盖不同场景的标准接入姿态：无论是由 AI 智能体自主调用、挂载为集成开发环境的 MCP 工具、在服务器与容器中独立运行，还是作为依赖集成到业务工程中，都能以规范化方式快速接入。

---

## 四大接入选型入口

根据具体的宿主环境与调用方式，选择对应的接入路径：

| 目标场景与宿主 | 推荐接入路径 | 对应指引 |
| :--- | :--- | :--- |
| AI 智能体自主消费 | Agent Skill 技能包 | [Agent Skill 使用指南](use-as-skill.md) |
| IDE 与开发工具接入 | MCP 协议服务（STDIO / HTTP） | [开发工具 MCP 接入](use-as-mcp.md) |
| 服务器与容器生产部署 | Node 交付目录 / HTTP 微服务 | [Node 交付产物运行](standalone-run.md) / [HTTP 微服务与 API 调度](http-service.md) |
| ActionDock 业务工程集成 | 工程依赖安装（`ad add`） | [选型四：面向 ActionDock 业务工程集成](#选型四面向-actiondock-业务工程集成ad-add) |

---

## 选型一：面向 AI 智能体自主调用（Agent Skill）

适用于 Claude Code、Cursor、Windsurf、Antigravity 等各类 AI 智能体。

通过技能管理工具直接装载技能：

```bash
# 全局安装 ActionDock 官方技能（供系统内所有智能体使用）
npx skills add team4u/actiondock -g -y

# 或安装 GitHub 上其他开源仓库的技能
npx skills add <owner/repo> -g -y
```

装载后，智能体将自动读取技能目录中的 `SKILL.md` 说明书与推荐操作规程，并在执行复杂任务时按需调度底层原子 Action。

若以本地离线目录形式获取 Skill，只需将其放入智能体指定的技能扩展目录中。Skill 内置的说明书会自动引导智能体完成自省与调用，无需使用者手动配置运行环境。

详细使用说明请参阅 [Agent Skill 使用指南](use-as-skill.md)。

---

## 选型二：面向开发工具与桌面客户端（MCP 服务）

适用于需要将 Action 能力作为工具扩展接入 Cursor、Windsurf、Claude Desktop 等支持 Model Context Protocol 协议的客户端。

### STDIO 模式接入

在集成开发环境的 MCP 配置文件中添加服务定义，通过标准输入输出通道通信：

```json
{
  "mcpServers": {
    "actiondock-tools": {
      "command": "ad",
      "args": ["mcp", "--all"]
    }
  }
}
```

### HTTP 传输模式接入

当客户端运行在远程或容器中时，可通过 HTTP 传输协议提供服务：

```bash
ad mcp serve --port 5178
```

详细配置参数与客户端接入指南请参阅 [开发工具 MCP 接入](use-as-mcp.md)。

---

## 选型三：面向服务器与容器生产部署（Node 目录与 HTTP 微服务）

当需要将能力部署至生产服务器、Kubernetes 集群、轻量容器或持续集成流水线时，ActionDock 提供两种无须外部守护进程的运行模式：

### 自包含 Node 目录独立运行

针对已构建完毕的 Node 目录型交付产物，目标环境只需通用 Node.js 运行时（版本大于等于 24.12.0），无需预先安装全局 ActionDock CLI 工具链：

```bash
# 执行 Action 并输出标准 JSON 信封
node ./dist/app/entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'
```

详细运行机制与限制请参阅 [Node 交付产物运行](standalone-run.md)。

### HTTP 远程微服务

通过 `ad serve` 启动轻量级微服务，暴露标准 RESTful API 端点，支持同步阻塞调用、异步任务轮询、SSE 事件流推送与全局能力自省：

```bash
ad serve --port 5177 --token "sk-actiondock-secret"
```

通过网络请求远程调度：

```bash
curl -X POST http://localhost:5177/api/v2/actions/list-prs/run \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{"input": {"repo": "team4u/actiondock"}}'
```

详细部署与接口规范请参阅 [HTTP 微服务与 API 调度](http-service.md)。

---

## 选型四：面向 ActionDock 业务工程集成（ad add）

当正在开发一个基于 ActionDock 的业务项目、微服务或智能体宿主工程，需要复用外部共享的 Action 包时，推荐使用依赖管理命令将其安装到当前工程中：

```bash
# 进入已有的 ActionDock 工程目录
cd my-project

# 安装外部 Action 包依赖并严格锁定
ad add @actiondock/example-tools
```

执行该命令后：
- 框架自动调用包管理器安装依赖，并解析目标包的清单规范。
- 依赖项自动记录在 `actiondock.json` 的 `dependencies` 字段中。
- 单一事实源锁文件 `actiondock.lock.json` 自动更新并固化版本与完整性散列。
- 原子事务机制全程提供快照防护，若安装或校验失败自动回滚。

安装完成后，即可在工程中直接以完全限定标识调用该 Action：

```bash
ad run example-tools/sample.greet --input '{"name": "ActionDock"}'
```

若后续不再需要该依赖包，可执行移除命令：

```bash
ad remove @actiondock/example-tools
```

系统会自动校验工程内是否存在未解除的 `uses` 级联调用与规程引用，确认安全后从项目清单与锁文件中同步剔除。

---

## 通用能力与环境管理

无论采用何种接入形态，ActionDock 均提供一致的配置治理与能力自省机制：

### 凭据与配置注入

Action 依赖的外部凭据（如 API 密钥、数据库连接串）可通过以下层级注入：

- 项目级持久化配置：`ad config set GITHUB_TOKEN ghp_xxx`（写入当前工程的配置存储）。
- 全局持久化配置：`ad config set GITHUB_TOKEN ghp_xxx -g`（对当前用户下所有调用生效）。
- 运行时环境变量：直接通过系统环境变量传入，例如 `GITHUB_TOKEN=ghp_xxx ad run ...`。
- 命令行临时覆盖：通过 `--config KEY=value` 参数在单次执行中临时覆盖。

详细规则请参阅 [配置注入与多环境管理](configuration.md)。

### 能力探索与自省

在任意安装了 ActionDock 的环境中，均可通过命令行探索当前可用的能力：

```bash
# 查看所有已加载的包与 Action 列表
ad info

# 模糊意图检索
ad info github

# 查看特定 Action 的输入输出模式契约与参数规范
ad describe team4u.github-tools/list-prs
```

---

## 本地开发与源码调试提示

若需要克隆 ActionDock 官方源码仓库、进行本地多包联合调试或向核心框架提交代码贡献，属于开发者流程，请参阅 [核心仓库贡献指南](../developer/contributing.md)。
