# @actiondock/cli

ActionDock 2.0 官方命令行门面工具链。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/cli` 提供 `ad` 命令行接口，用于开发、测试、构建、分发和运行 AI 智能体工具与技能。

---

## 运行环境

- 原生基于 Node.js 22+ 与 Node.js 24 LTS 运行。
- 支持 npm、pnpm 与 yarn 进行全局安装或项目级管理。
- 日常开发、调试、测试、MCP 服务启动与 HTTP 部署完全基于 Node.js，无需安装 Bun。
- 仅在使用 `ad build` 编译单文件独立二进制产物时，需要系统安装外部 Bun 编译器。

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
ad export skill
```

- 编译为零依赖单文件独立二进制产物（需外部安装 Bun）：
```bash
ad build
```

---

## 常用命令速查

| 命令 | 说明 |
|---|---|
| `ad init [dir]` | 初始化 Action Package 项目脚手架 |
| `ad info [patterns...]` | 检索包元数据与能力清单，支持模式匹配与树形展示 |
| `ad doctor` | 执行运行环境与项目结构健康诊断 |
| `ad run <id>` | 本地执行指定 Action 并输出标准信封结果 |
| `ad action list` | 列出包内所有已注册的 Action |
| `ad playbook list` / `show` | 查看智能体操作规程 Playbook |
| `ad config list` / `get` / `set` | 管理包运行时配置与环境变量绑定 |
| `ad state list` / `get` / `set` / `delete` / `clear` | 查看与维护 SQLite 持久化状态 |
| `ad runs list` / `show` | 查询任务执行历史与追踪记录 |
| `ad test` | 执行快速单元测试 |
| `ad build` | 调度外部 Bun 编译器打包单文件独立二进制产物 |
| `ad export skill` | 导出包含操作规程的 Agent Skill 技能包 |
| `ad link` / `unlink` | 注册或注销工作区全局路由与符号链接 |
| `ad profile` | 管理远程执行节点凭证与环境配置 |
| `ad serve` | 启动远程 HTTP 执行调度微服务 |
| `ad mcp` | 以 STDIO 或 HTTP 协议启动 MCP 服务 |

---

## 架构集成

作为顶层门面，`@actiondock/cli` 串联以下子包：

- 运行时适配：依赖 `@actiondock/runtime-node`，在启动时自动注入基于 Node.js 原生能力的驱动实现。
- 共享命令集：复用 `@actiondock/runtime-cli` 的命令处理器与标准信封输出渲染器。
- 构建与打包：调用 `@actiondock/builder` 完成依赖闭包分析与产物装配。
- 协议服务：通过 `@actiondock/mcp` 与 `@actiondock/core` 启动协议监听。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
