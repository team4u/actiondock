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

ActionDock 文档中心遵循渐进式学习曲线与角色双轨制架构设计：

```text
文档中心架构
├── 快速入门       # 系统总览、环境准备与五分钟上手体验
├── 使用者指南     # 智能体装载、MCP 工具挂载、微服务部署与独立运行
├── 开发者指南     # 动作开发、规程编写、沙箱单测与打包导出
├── 场景实战食谱   # 外部服务、命令执行、长任务异步、级联调用与智能体协同
├── 核心概念深潜   # 动作包模型、强类型契约、上下文对象与规程机制
├── 权威参考手册   # CLI 命令速查、清单规范、SDK API、测试 API 与错误码
└── 底层架构解密   # 状态机模型、物理通道隔离与生产安全防御
```

---

## 快速导航索引

### 快速入门

- [系统概览与心智模型](getting-started/overview.md)：痛点剖析、设计理念与角色双轨路径。
- [运行环境准备与安装](getting-started/installation.md)：Node.js 24 基础环境、全局命令与贡献者开发流程。
- [五分钟极速上手教程](getting-started/five-minute-tour.md)：从零构建第一个 Action 并全模态运行。

---

### 使用者指南

面向从代码仓库拉取项目源码、获取导出的技能包或运行交付产物的使用者与智能体操作端：

- [消费与接入总览](consumer/overview.md)：工程依赖消费、智能体技能装载与三种接入路径选型对比。
- [Agent Skill 使用指南](consumer/use-as-skill.md)：通过技能管理器一键安装、智能体装载路径与规程调用规范。
- [开发工具 MCP 接入](consumer/use-as-mcp.md)：作为 MCP STDIO 服务直连 Cursor、Windsurf 与 Claude Code 等集成开发环境。
- [Node 交付产物运行](consumer/standalone-run.md)：自包含 Node.js 目录交付产物运行与离线依赖支持。
- [HTTP 微服务与 API 调度](consumer/http-service.md)：启动持久微服务并通过 REST API 远程调度。
- [消费端配置与凭证注入](consumer/configuration.md)：API 令牌、环境变量与持久化配置注入。

---

### 开发者指南

面向从零打造原子能力、编写操作规程并分发的工具创作者：

- [快速上手开发](developer/quick-start.md)：工程初始化、编写动作执行函数与本地试跑。
- [深入业务 Action 开发](developer/first-action.md)：强类型模式、状态持久化、配置读取与外部 API 调用。
- [编写 Playbook 规程](developer/playbooks.md)：为智能体沉淀领域专家作业规程编排与安全红线。
- [单元测试与沙箱验证](developer/testing.md)：基于测试运行时的纯内存毫秒级验证与虚拟时钟。
- [状态持久化与 SQLite 存储](developer/storage.md)：内嵌 SQLite 数据模型、键值持久化与过期策略。
- [多环境 Profile 与远程调度](developer/profiles.md)：多云环境节点管理与安全凭证防护。
- [构建打包与 Skill 导出](developer/build-and-export.md)：构建 Node 目录交付产物，按 Playbook 裁剪导出 Agent Skill 并发布。

---

### 场景实战食谱

面向真实工程高频场景的工业级即用方案：

- [高可用外部 API 接入实战](cookbook/external-apis.md)：网络请求、密钥防护、指数退避重试与取消信号透传。
- [受控系统命令与子进程执行](cookbook/process-execution.md)：物理管道隔离、输出容量防御性截断与进程树跨平台清理。
- [长时间异步任务与进度上报](cookbook/long-running-tasks.md)：阶段进度同步与异步任务协议集成。
- [多 Action 组合编排与防死锁](cookbook/composing-actions.md)：级联调用深度限制与环路死锁阻断机制。
- [智能体协同开发与自愈闭环实战](cookbook/ai-agent-development.md)：大模型自主阅读规程、编写代码与闭环自愈指南。

---

### 核心概念深潜

- [Action Package 核心抽象](concepts/action-package.md)：包能力、操作规程、接口契约与运行态四大支柱。
- [Action 原子能力契约](concepts/action.md)：动作定义函数与模式即契约设计哲学。
- [ActionContext 运行时上下文](concepts/action-context.md)：配置解析、SQLite 持久化、级联调用、日志隔离与取消链路。
- [Playbook 规程模型](concepts/playbook.md)：面向智能体的标准作业规程、流程时序与安全红线。
- [Agent Skill 技能资产规范](concepts/skill.md)：源码型与 Node 目录型双模导出交付规范。

---

### 权威参考手册

- [CLI 命令行速查](reference/cli.md)：全量子命令、参数选项、环境依赖与退出码规范。
- [actiondock.json 清单规范权威手册](reference/schema.md)：项目清单全量字段、类型约束与配置示例。
- [Action SDK API 参考](reference/action-api.md)：公共 SDK 核心导出函数与接口契约规范。
- [Testing 测试框架 API 参考](reference/testing-api.md)：独立测试包导出的测试运行时、虚拟时钟与模拟组件参考。
- [配置解析回退机制](reference/config.md)：配置多级回退规则、环境变量转换与类型强转。
- [错误代码速查手册](reference/error-codes.md)：标准 JSON 错误信封与故障自愈决策表。
- [版本迁移参考指南](reference/v1-to-v2-migration.md)：旧版架构升级对比与平滑演进步骤。

---

### 底层架构解密

- [Runtime 执行引擎架构](architecture/runtime.md)：单一终态状态机、并发调度队列与配额管理。
- [输出通道物理隔离设计](architecture/stdout-stderr.md)：数据通道与诊断通道物理隔离，杜绝大模型解析崩溃。
- [安全加固与防御模型](architecture/security.md)：非回环鉴权、常数时间比对与原型污染防护。
