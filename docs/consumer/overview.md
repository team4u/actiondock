# 消费与接入总览

作为 ActionDock 框架的使用者，不需要关心底层如何编写复杂的 TypeScript 业务编排或存储驱动细节。无论是通过依赖管理器将发布的公共包安装至当前工程、使用智能体技能管理工具直接装载，还是通过本地软链接快速体验示例包与交付产物，都能以标准化方式快速接入。

---

## 核心消费路径选择

ActionDock 为不同使用场景提供了三条清晰的标准消费路径：

```text
                               ┌─ 路径一：项目工程依赖消费 (ad add)
                               │  面向具备工程清单的正式项目，享受版本锁定与原子事务保护
                               │
三种标准消费路径 ──────────────┼─ 路径二：智能体技能一键装载 (npx skills)
                               │  面向 AI 智能体，直接载入描述规范与 Playbook 规程
                               │
                               └─ 路径三：本地源码全局注册 (ad link)
                                  面向克隆官方源码后的快速体验与本地免工程调试
```

### 路径一：在项目工程中安装并消费依赖（推荐的标准工程化消费）

当您在开发一个业务项目、微服务或智能体宿主工程时，消费外部共享 Action 的标准方式是通过依赖管理命令将其安装至当前工程：

```bash
# 初始化或进入已有的 ActionDock 工程目录
cd my-project

# 安装外部 Action 包依赖并严格锁定（如示例工具包）
ad add @actiondock/example-tools
```

执行该命令后：
- 框架自动调用包管理器安装依赖，并读取目标包的清单规范。
- 依赖项被声明写入 `actiondock.json` 的 `dependencies` 清单中。
- 单一事实源锁文件 `actiondock.lock.json` 自动更新并固化精确版本与完整性散列。
- 底层原子事务机制全程提供快照防护，若安装或校验失败自动回滚恢复。

安装完成后，即可直接以完全限定标识调用该 Action：

```bash
ad run example-tools/sample.greet --input '{"name": "ActionDock"}'
```

若后续项目中不再需要该外部依赖包，可执行依赖移除命令：

```bash
ad remove @actiondock/example-tools
```

系统会自动校验工程内是否存在未解除的 `uses` 级联调用与规程引用，确认安全后从 `package.json`、`actiondock.json` 与 `actiondock.lock.json` 中同步剔除，并默认保留该包的历史配置与状态存储命名空间。

### 路径二：作为智能体技能一键装载（面向 AI 智能体）

智能体生态支持通过技能管理工具直接从 GitHub 仓库全局安装技能：

```bash
# 全局安装 ActionDock 官方技能（供系统内所有智能体使用）
npx skills add team4u/actiondock -g -y

# 或安装 GitHub 上其他第三方开源仓库的技能
npx skills add <owner/repo> -g -y
```

安装后，Claude Code、Cursor、Antigravity 等智能体将在启动时自动读取规程索引并按需调度底层原子 Action。

### 路径三：克隆源码并全局注册（本地体验与免工程调试）

如果手头没有创建工程，仅希望下载官方仓库或第三方源码并快速体验调用：

```bash
# 克隆官方仓库
git clone https://github.com/team4u/actiondock.git
cd actiondock

# 在仓库根目录执行 link（自动识别工作区，一键发现并注册全部内置示例包）
ad link
```

注册完成后，ActionDock 将本地包路径记录在本机开发者的全局路由表中。在系统的任意终端路径下，无需进入包目录即可直接调用：

```bash
ad run team4u.github-tools/list-prs --input '{"repo": "team4u/actiondock"}'
```

---

## 命令选型速查：依赖安装与全局注册对比

依赖安装命令 `ad add` 与全局注册命令 `ad link` 具有严格的职责划分与适用边界：

| 比较维度 | 依赖安装命令 ad add | 全局注册命令 ad link |
| :--- | :--- | :--- |
| **操作对象** | 发布的 npm 包名（或包归档文件） | 本地磁盘上的源码目录路径 |
| **生效范围** | **当前项目工程及其构建闭包**有效 | **当前机器操作系统用户全局**有效 |
| **适用前提** | 当前目录或指定路径必须包含 `actiondock.json` | 无需工程环境，任意本地路径均可 |
| **持久化位置** | 项目内的 `package.json`、`actiondock.json` 与 `actiondock.lock.json` | 仅写入本机用户全局路由表 `~/.actiondock/registry.json` |
| **版本锁定** | 强制生成版本与完整性锁定，支持依赖冲突检测 | 无版本锁定，仅登记本地目录物理路径 |
| **事务与回滚** | 具备原子事务快照保护，出错自动原子回滚 | 无事务机制 |
| **产物可移植性** | 高。锁文件跟随项目版本管理，确保生产与 CI 环境确定一致 | 无。仅限本机开发环境，无法跨机器移植 |
| **典型适用场景** | 正式业务项目集成、多包依赖编排、CI 流水线、生产部署构建 | 克隆源码快速试跑、本地多包联合调试、全局微服务聚合 |

---

## 体验不同消费形态

依托已安装的依赖或已链接的示例包，可以体验不同的消费姿态：

### 命令行直接调用与标准 JSON 信封输出

在终端中执行 Action，获得结构化数据输出：

```bash
ad run team4u.github-tools/list-prs --input '{"repo": "team4u/actiondock"}'
```

标准输出通道输出标准 JSON 信封：

```json
{
  "ok": true,
  "runId": "01JMBD6...",
  "data": {
    "items": [
      {
        "number": 101,
        "title": "feat(core): support native node execution",
        "author": "octocat",
        "state": "open"
      },
      {
        "number": 102,
        "title": "fix(storage): improve sqlite concurrency with wal",
        "author": "team4u",
        "state": "open"
      }
    ],
    "count": 2
  }
}
```

### 挂载为集成开发环境的 MCP 服务

ActionDock 原生支持 Model Context Protocol 协议规范：

- 挂载项目工程及其锁定依赖：在已执行 `ad add` 的项目根目录中，指定工作目录直接运行 `ad mcp`，自动暴露工程及其所有依赖能力。
- 全局一键挂载已链接包：在 Cursor、Windsurf 或 Claude Code 的 MCP 配置文件中添加 `--all` 参数，一次性挂载所有已注册包：

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

### 启动 HTTP 远程微服务

在任意终端路径或特定工程目录下启动轻量级微服务：

```bash
# 全局路由模式：聚合全局注册表中已链接的所有包
ad serve --port 8080

# 单工程模式：进入包含 actiondock.json 的目录启动，自动聚合本项目与 ad add 锁定的依赖
cd my-project
ad serve --port 8080
```

启动后可通过 cURL 或网络请求远程调度动作，同时提供 MCP 协议端点与健康检查接口。

### 构建为 Node.js 运行时交付目录

在包含 Action 的项目根目录下执行构建：

```bash
ad build --out ./dist/delivery --vendor-deps
```

产生可直接独立运行的 Node.js 交付目录，内嵌统一入口脚本与锁定的生产依赖，在目标宿主仅需 Node.js 即可运行：

```bash
node ./dist/delivery/entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'
```

---

## 注入真实凭证与配置治理

ActionDock 内置开箱即用的示例数据降级机制。在未注入真实访问凭据时，系统自动返回模拟数据便于调试；当需要请求外部真实服务时，可按需注入凭据：

```bash
# 项目级持久化存储（存入当前项目独立的 SQLite 配置数据库）
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx

# 全局持久化存储（对当前用户下所有跨目录调用的包生效）
ad config set GITHUB_TOKEN ghp_xxxxxxxxxxxxxxxxxxxx -g

# 命令行单次临时覆盖
ad run team4u.github-tools/list-prs --config GITHUB_TOKEN=ghp_xxx --input '{"repo": "team4u/actiondock"}'
```

---

## 消费姿态对比速查

| 消费姿态 | 适用场景 | 目标客户端与宿主 | 环境依赖 |
| :--- | :--- | :--- | :--- |
| **工程依赖消费** | 在已有项目中引入外部 Action 进行组合调用 | Node.js 业务工程与流水线 | 本地具备 `ad` 与 `actiondock.lock.json` |
| **Agent Skill** | 模型自主理解规程并按需调度 | Claude Code, Antigravity, Cursor | 源码型需 Node.js 与 ad；目录型仅需 Node.js |
| **MCP 服务** | 本地集成开发环境扩展工具调用 | Cursor, Windsurf, Claude Code | 本地安装 `ad` 命令行工具 |
| **独立目录交付** | 生产服务器部署、流水线与容器 | Linux, macOS, Windows 服务器与容器 | 仅需兼容的 Node.js 运行时 |
| **HTTP 远程微服务** | 远程集群、多租户云服务、网络调度 | 任意支持网络请求的智能体或业务系统 | 服务端通过 `ad serve` 运行 |

---

## 全局能力探索与自省

查看当前环境中可用的包与 Action：

```bash
# 查看所有已加载的工作区与包
ad info

# 模糊意图匹配搜索
ad info github

# 查看工作区层级树
ad info --tree

# 查看特定动作的接口契约规范与参数要求
ad describe team4u.github-tools/list-prs
```

---

## 各消费姿态深入指南

- [接入集成开发环境 MCP 服务](file:///root/code/action-dock/docs/consumer/use-as-mcp.md)：配置文件中添加 STDIO MCP 服务与项目工程挂载。
- [Agent Skill 使用指南](file:///root/code/action-dock/docs/consumer/use-as-skill.md)：通过技能工具安装与规程优先调用规范。
- [Node.js 目录独立运行指南](file:///root/code/action-dock/docs/consumer/standalone-run.md)：在生产服务器或容器中免脚手架独立运行。
- [HTTP 远程微服务与网络调度](file:///root/code/action-dock/docs/consumer/http-service.md)：启动 HTTP 服务并通过网络接口远程调用。
- [消费端配置与凭证注入](file:///root/code/action-dock/docs/consumer/configuration.md)：配置覆盖、环境变量与安全令牌管理。
