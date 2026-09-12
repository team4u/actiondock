# ActionDock 文档中心

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[官网文档](https://team4u.github.io/actiondock/)

一次编写，全模态交付。

面向智能体动作与技能的工业级开发、测试、构建与分发工具链。基于 TypeScript 编写强类型原子能力，依托纯内存沙箱实现毫秒级自动化测试与自愈闭环，原生交付为 MCP 协议服务、智能体技能包、HTTP 微服务与自包含 Node.js 目录交付产物。

---

## 智能体极速上手

智能体客户端可使用技能管理器从代码仓库直接安装 ActionDock 技能资产：

```bash
# 全局安装 ActionDock 官方技能
npx skills add team4u/actiondock -g -y

# 或安装开源仓库的指定技能
npx skills add <owner/repo> -g -y
```

安装完成后，智能体即可自动识别 SKILL.md 与操作规程，并在执行任务时自主调度底层原子能力。

---

## 文档体系全景

ActionDock 文档中心采用紧凑、权威且零冗余的六大模块设计：

```text
文档中心架构
├── 快速入门     # 系统总览、运行环境准备与快速上手指南
├── 开发者指南   # Action 模型开发、规程编写、沙箱单测、状态存储、构建导出与贡献指南
├── 场景实战     # 外部 API、系统命令、异步长任务、级联调用与智能体协同自愈
├── 消费接入指南 # 四大选型入口、技能装载、MCP 工具挂载、独立目录运行与配置管理
├── 权威参考手册 # CLI 速查、清单规范、SDK API、测试 API、HTTP 契约与错误码
└── 底层架构解密 # 状态机模型、物理通道隔离与生产安全防御
```

---

## 快速导航索引

### 快速入门

- [系统概览与心智模型](getting-started/overview.md)：痛点剖析、设计理念与角色双轨路径。
- [运行环境准备与安装](getting-started/installation.md)：Node.js 24 基础环境准备与 CLI 工具链安装。
- [快速上手指南](getting-started/quick-start.md)：从零构建第一个 Action 并全模态运行。

---

### 开发者指南

面向从零打造原子能力、编写操作规程并分发的工具创作者：

- [Action 核心模型与开发指南](developer/first-action.md)：强类型契约、ActionContext 上下文、状态持久化与 API 集成。
- [Playbook 规程编写指南](developer/playbooks.md)：为智能体沉淀领域专家作业规程编排、委托依赖与安全红线。
- [单元测试与沙箱验证](developer/testing.md)：基于测试运行时的纯内存毫秒级验证与虚拟时钟。
- [状态持久化与 SQLite 存储](developer/storage.md)：内嵌 SQLite 数据模型、键值持久化与过期策略。
- [构建打包与 Skill 导出规范](developer/build-and-export.md)：构建 Node 目录交付产物，按 Playbook 裁剪导出 Agent Skill 并发布。
- [核心仓库贡献指南](developer/contributing.md)：ActionDock 框架源码克隆、本地多包联调与贡献者验证流程。

---

### 场景实战

面向真实工程高频场景的工业级即用方案：

- [高可用外部 API 接入](practices/external-apis.md)：网络请求、密钥防护、指数退避重试与取消信号透传。
- [受控系统命令与子进程执行](practices/process-execution.md)：物理管道隔离、输出容量防御性截断与进程树跨平台清理。
- [长时间异步任务与进度上报](practices/long-running-tasks.md)：阶段进度同步与异步任务协议集成。
- [多 Action 组合编排与防死锁](practices/composing-actions.md)：级联调用深度限制与环路死锁阻断机制。
- [智能体协同开发与自愈闭环](practices/ai-agent-development.md)：大模型自主阅读规程、编写代码与闭环自愈指南。

---

### 消费接入指南

面向从代码仓库拉取项目源码、获取导出的技能包或运行交付产物的使用者与智能体操作端：

- [消费与接入总览](consumer/overview.md)：四大选型入口（Agent Skill、MCP 服务、独立 Node/HTTP 微服务、工程依赖）与接入指南。
- [Agent Skill 使用指南](consumer/use-as-skill.md)：通过技能管理器一键安装、智能体装载路径与规程调用规范。
- [开发工具 MCP 接入](consumer/use-as-mcp.md)：作为 MCP STDIO 服务直连 Cursor、Windsurf 与 Claude Code 等集成开发环境。
- [Node 交付产物运行](consumer/standalone-run.md)：自包含 Node.js 目录交付产物运行与离线依赖支持。
- [HTTP 微服务与 API 调度](consumer/http-service.md)：启动持久微服务、令牌鉴权与 RESTful 同步/异步任务调度。
- [配置注入与多环境管理](consumer/configuration.md)：API 令牌、环境变量、SQLite 持久化配置与多环境 Profile 调度。

---

### 权威参考手册

- [CLI 命令行速查](reference/cli.md)：全量子命令、参数选项、环境依赖与退出码规范。
- [actiondock.json 清单规范权威手册](reference/schema.md)：项目清单全量字段、类型约束与配置示例。
- [Action SDK API 参考](reference/action-api.md)：公共 SDK 核心导出函数与接口契约规范。
- [Testing 测试框架 API 参考](reference/testing-api.md)：独立测试包导出的测试运行时、虚拟时钟与模拟组件参考。
- [HTTP API 接口契约](reference/http-api.md)：完整的 RESTful 端点规范、请求响应 Schema、SSE 流与错误码。
- [配置解析回退机制](reference/config.md)：配置多级回退规则、环境变量转换与类型强转。
- [错误代码速查手册](reference/error-codes.md)：标准 JSON 错误信封与故障自愈决策表。

---

### 底层架构解密

- [Runtime 执行引擎与通道隔离](architecture/runtime.md)：单一终态状态机、并发调度队列、配额管理与标准输出物理隔离。
- [安全加固与防御模型](architecture/security.md)：非回环鉴权、常数时间比对与原型污染防护。
