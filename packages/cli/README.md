# @actiondock/cli

ActionDock 2.0 官方命令行门面工具链。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/cli` 提供 `ad` 命令行接口，用于开发、测试、构建、分发和运行 AI 智能体工具与技能。

---

## 运行环境

- 原生基于 Node.js >=24.12.0 运行，充分依托原生类型擦除、内置 SQLite 与原生 HTTP 特性。
- 支持 npm、pnpm 与 yarn 标准包管理器进行全局安装与项目级管理。
- 日常开发、调试、测试、构建、打包、MCP 服务启动与 HTTP 部署完全基于 Node.js 与 npm 标准工作流，无需安装外部编译器。
- 单文件独立二进制构建（`--target`、`--bytecode`、`--standalone`）与 `actiondock.manifest.json` 已在 2.0 中彻底移除，由标准的 Node.js 目录交付产物与 npm 打包取代。

---

## 安装方式

使用标准包管理器全局安装：

```bash
npm install -g @actiondock/cli
```

也可以在项目中通过 npx 临时调用：

```bash
npx ad --help
```

---

## 快速上手流程

- 初始化项目脚手架：
```bash
ad init my-tools
cd my-tools
npm install
```

- 安装并锁定依赖（基于 actiondock.lock.json 与原子事务）：
```bash
ad add @actiondock/example-tools
```

- 本地执行 Action：
```bash
ad run sample.greet --input '{"name": "Alice"}'
```

- 运行单元测试：
```bash
ad test
```

- 启动为 MCP 协议服务：
```bash
ad mcp
```

- 导出为便携式 Agent Skill 技能包：
```bash
# 导出源码模式技能
ad export skill

# 导出自包含 Node.js 目录模式技能
ad export skill --mode node
```

- 构建 Node.js 目录交付产物：
```bash
ad build
```

- 打包为标准 npm tarball：
```bash
ad pack
```

---

## 通用选项与调用契约

所有 CLI 子命令均支持传入通用控制选项：

- `-v, -V, --version`：打印版本号并退出。
- `-h, --help`：打印命令帮助并退出。
- `--json`：以标准 JSON 格式输出结果。
- `--envelope`：将输出包装为标准信封结构对象（包含 `ok: true, data: T` 或 `ok: false, error: { code, message, details }`）。
- `--data-dir <path>`：指定自定义数据存储目录，实现多测试或多任务数据隔离。

### 严格目标解析机制

- 严格目标定位：通过 `-P, --package <id|path>` 指定目标包。系统严格区分物理路径与注册表包标识符，若目标不存在则不向当前目录或父级目录隐式回退，直接以参数校验错误退出。
- 多目标检索契约：在执行多目标检索（如 `ad info` 或 `ad list`）时，若无任何匹配项，在机器模式下始终返回确定性空数组结构并以状态码 0 退出，不因空搜索产生异常中断。

---

## 常用命令速查

| 命令 | 说明 |
|---|---|
| `ad init [dir]` | 初始化 Action Package 项目脚手架 |
| `ad add <package>` | 安装并锁定 Action 依赖，更新 actiondock.lock.json 并提供原子回滚保护 |
| `ad remove <package>` | 卸载并更新锁定依赖，提供原子回滚保护 |
| `ad info [patterns...]` | 检索包元数据与能力清单，支持模式匹配与树形展示 |
| `ad list [patterns...]` | 列出包内所有已注册的 Action |
| `ad describe <id>` | 查看 Action 的详情、参数与模式规范（别名 `ad show`） |
| `ad run <id>` | 本地或远程执行指定 Action 并输出标准信封结果 |
| `ad validate [id]` | 校验 Action 规范与模式规范 |
| `ad doctor` | 执行运行环境与项目结构健康诊断 |
| `ad action create <id>` | 创建新 Action 源码（别名 `ad action new`） |
| `ad playbook list` / `show` | 查看智能体操作规程 Playbook |
| `ad config list` / `get` / `set` | 管理包运行时配置与环境变量绑定 |
| `ad state list` / `get` / `set` / `delete` / `clear` | 查看与维护 SQLite 持久化状态 |
| `ad runs list` / `show` | 查询任务执行历史与追踪记录 |
| `ad test` | 执行快速单元测试 |
| `ad build` | 构建 Node.js 目录交付产物（支持 `--vendor-deps` 与 `--archive`） |
| `ad pack` | 打包为标准 npm tarball（`.tgz`），支持 `--dry-run` |
| `ad export skill` | 导出 Agent Skill 技能包（支持 `--mode source` 与 `--mode node`） |
| `ad link` / `unlink` | 注册或注销工作区全局路由与符号链接 |
| `ad profile` | 管理远程执行节点凭证与环境配置 |
| `ad serve` | 启动远程 HTTP 执行调度微服务 |
| `ad mcp` | 以 STDIO 或 HTTP 协议启动 MCP 服务 |

---

## 架构集成

作为顶层门面与独立运行分发器，`@actiondock/cli` 串联以下子包：

- 运行时适配：依赖 [@actiondock/runtime-node](file:///root/code/action-dock/packages/runtime-node/README.md)，在启动时自动注入基于 Node.js 原生能力的驱动实现。
- 领域内核：依赖 [@actiondock/core](file:///root/code/action-dock/packages/core/README.md)，调度统一调用门面 ActionDockTarget、数据目录锁 DataDirLock 与依赖事务管理器。
- 构建与打包：依赖 [@actiondock/builder](file:///root/code/action-dock/packages/builder/README.md)，完成目录交付构建、npm 打包与技能导出。
- 协议服务：通过 [@actiondock/mcp](file:///root/code/action-dock/packages/mcp/README.md) 启动协议监听。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
