# ActionDock 2.0 官方技术文档

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-81%20passed-brightgreen.svg)](https://github.com/team4u/actiondock)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **一次编写，全模态交付。**
> 面向 AI 智能体的 Action 与 Skill 开发、测试、构建与分发工具链。
> 用 TypeScript 编写原子工具，毫秒级纯内存单测，一键编译为零依赖独立二进制，原生直连 MCP 与 Agent Skill。

---

## 智能体极速上手

ActionDock 是专为 AI 智能体设计的工具底座。智能体客户端（如 Claude Code、Cursor、Antigravity、GitHub Copilot CLI 等）可直接使用 `npx skills` 从 GitHub 仓库一键安装技能：

```bash
# 一键安装 ActionDock 官方技能（-y 自动确认并完成环境适配）
npx skills add team4u/actiondock -y

# 安装 GitHub 上任意开源仓库的技能
npx skills add <owner/repo> -y
```

安装完成后，智能体即可自动识别 `SKILL.md` 与操作规程，并在执行任务时自主调度原子能力。详见 [Agent Skill 使用指南](consumer/use-as-skill.md)。

---

## 文档分类导航

ActionDock 文档中心遵循使用者与开发者角色双轨制设计：

```text
快速概览   = 环境准备与全景双轨导引
使用者指南 = 拿到包或 Skill 怎么在智能体与 IDE 中用起来
开发者指南 = 从零编写、单测、编译与导出发布 Skill
核心概念   = Action Package、ActionContext、Playbook 底层模型
参考手册   = CLI、配置解析、SDK API、错误速查
底层架构   = 执行引擎、通道隔离、安全防御
```

---

### 快速概览
- [环境安装与准备](getting-started/installation.md)：Bun 与 `ac` CLI 安装配置、Link 机制与排错。
- [核心概览与双轨导引](getting-started/overview.md)：了解 ActionDock 核心全景与角色路径选择。

---

### 使用者指南
面向从仓库拉取项目源码、获取导出的 Skill 包或下载二进制的使用者与智能体操作者：
- [消费与接入总览](consumer/overview.md)：消费姿态对比速查与克隆极速跑通。
- [Agent Skill 使用指南](consumer/use-as-skill.md)：通过 npx skills 一键安装 GitHub 技能、智能体装载路径与规程优先调用规范。
- [接入 Cursor / Windsurf / IDE (MCP 服务)](consumer/use-as-mcp.md)：作为 MCP STDIO 服务直连 IDE 工具库。
- [独立二进制与免环境运行](consumer/standalone-run.md)：在无 Node.js / Bun 的服务器/沙箱中零依赖运行。
- [HTTP 远程微服务与 API 调度](consumer/http-service.md)：启动持久微服务并通过 REST API 远程调度。
- [消费端配置与凭证注入](consumer/configuration.md)：API Token、环境变量与 SQLite 持久化配置注入。

---

### 开发者指南
面向从零打造原子能力、编写规程并分发的工具创作者：
- [快速上手开发](developer/quick-start.md)：初始化、编写 `defineAction` 与本地试跑。
- [深入业务 Action 开发](developer/first-action.md)：强类型 Schema、`ctx.state` 持久化、`ctx.config` 读取与外部 API。
- [编写 Playbook 规程](developer/playbooks.md)：为 AI 智能体编写领域专家的标准作业步骤。
- [单元测试与沙箱验证](developer/testing.md)：基于 `createTestRuntime` 的纯内存毫秒级测试。
- [状态持久化与 SQLite 存储](developer/storage.md)：内嵌 SQLite 数据模型、KV 持久化与 TTL 过期。
- [多环境 Profile 与远程调度](developer/profiles.md)：多云环境节点管理与安全凭证防护。
- [构建、打包与 Skill 导出](developer/build-and-export.md)：编译单文件零依赖可执行程序，按 Playbook 裁剪导出 Agent Skill 并发布。

---

### 核心概念
- [Action Package 核心抽象](concepts/action-package.md)：四大支柱（能力、规程、契约、运行态）。
- [Action 原子能力契约](concepts/action.md)：`defineAction`、强类型约束与 Schema 即契约。
- [ActionContext 运行时上下文](concepts/action-context.md)：配置解析、SQLite 持久化、级联调用、日志隔离与取消链路。
- [Playbook 规程模型](concepts/playbook.md)：面向 AI 智能体的领域操作规程、流程时序与安全红线。
- [Agent Skill 交付物规范](concepts/skill.md)：源码型与独立二进制型 Skill 双模交付规范。

---

### 参考手册
- [CLI 命令行速查](reference/cli.md)：全量 `ac` 命令、选项与参数清单。
- [配置解析回退机制](reference/config.md)：配置回退规则、环境变量转换与类型强转。
- [Action SDK API 参考](reference/action-api.md)：`@actiondock/sdk` 导出接口与函数规范。
- [错误代码与排错速查](reference/error-codes.md)：标准 JSON 错误 Envelope 与修复指南。
- [1.0 到 2.0 迁移指南](reference/v1-to-v2-migration.md)：架构对比与升级步骤。

---

### 底层架构
- [Runtime 执行引擎](architecture/runtime.md)：`ActionRunner` 执行生命周期与拦截器体系。
- [标准输出与错误通道隔离](architecture/stdout-stderr.md)：数据通道与诊断通道物理隔离，杜绝大模型解析崩溃。
- [安全加固与防御模型](architecture/security.md)：非回环认证、权限固化、常数时间比对与原型污染防护。
