# ActionDock 2.0 官方技术文档

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-71%20passed-brightgreen.svg)](https://github.com/team4u/actiondock)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Build Agent Tools once. Run them anywhere.**
> 面向 AI Agent 的 Action 与 Skill 开发、测试、构建与分发工具链。
> 用 TypeScript 编写原子工具，毫秒级纯内存单测，一键编译为零依赖独立二进制，原生直连 MCP 与 Agent Skill。

---

## 📚 文档分类导航

ActionDock 文档中心遵循清晰的五层架构设计：

```text
Getting Started (新手入门) = 我怎么跑起来
Concepts        (核心概念) = 它是什么
Guides          (实践指南) = 我要完成某项任务
Reference       (参考手册) = 参数与 API 是什么
Architecture    (底层架构) = 为什么这么设计
```

---

### 1. 新手入门 (Getting Started)
从零开始搭建开发环境并在数分钟内掌握基础流程：
- [环境安装与准备](getting-started/installation.md)：Bun 与 `ac` CLI 安装配置。
- [快速上手 (Quick Start)](getting-started/quick-start.md)：3 分钟初始化、编写、测试与交付工具。
- [编写首个业务 Action](getting-started/first-action.md)：实战构建带参数校验、配置、状态与单测的 GitHub Action。

---

### 2. 核心概念 (Concepts)
深入理解 ActionDock 的核心建模抽象：
- [Action Package 核心抽象](concepts/action-package.md)：**[核心文档]** 四大支柱（Capability, Procedure, Contract, Runtime）。
- [Action 原子能力](concepts/action.md)：`defineAction`、强类型约束与 Schema 即契约。
- [ActionContext 运行时上下文](concepts/action-context.md)：5 级配置、SQLite 持久化、级联调用、日志隔离与取消链路。
- [Playbook SOP 规程](concepts/playbook.md)：面向 AI Agent 的领域操作规程、流程时序与安全红线。
- [Agent Skill 技能交付物](concepts/skill.md)：源码型与独立二进制型 Skill 双模交付规范。

---

### 3. 实践指南 (Guides)
解决具体工程场景的操作手册：
- [测试与验证指南](guides/testing.md)：基于 `createTestRuntime` 的纯内存毫秒级沙箱测试。
- [MCP 协议集成指南](guides/mcp.md)：STDIO / HTTP Transport 模式与 Claude Code/Cursor 直连。
- [独立二进制编译构建](guides/standalone-build.md)：`ac build` 编译单文件零依赖可执行程序。
- [Skill 导出与分发](guides/skill-export.md)：`ac export skill` 与按 Playbook 按需裁剪打包。
- [HTTP 服务与远程调度](guides/http-server.md)：`ac serve` 轻量 REST API 与异步长任务调度。
- [SQLite 存储与状态管理](guides/storage.md)：内嵌 SQLite 数据模型、KV 持久化与 TTL 过期。
- [多环境 Profile 与远程调度](guides/profiles.md)：多云环境节点管理与安全凭证防护。

---

### 4. 参考手册 (Reference)
权威参数速查与 API 手册：
- [CLI 命令行手册](reference/cli.md)：全量 `ac` 命令、选项与参数清单。
- [配置解析机制](reference/config.md)：5 级回退规则、环境变量转换与类型强转。
- [Action SDK API](reference/action-api.md)：`@actiondock/sdk` 导出接口与函数规范。
- [错误代码与排错速查](reference/error-codes.md)：标准 JSON 错误 Envelope 与修复指南。
- [1.0 到 2.0 架构对比与迁移](reference/v1-to-v2-migration.md)：7 维架构对比与升级步骤。

---

### 5. 底层架构 (Architecture)
深入探究 ActionDock 的底层技术原理：
- [Runtime 执行引擎](architecture/runtime.md)：`ActionRunner` 执行生命周期与拦截器体系。
- [Stdout/Stderr 物理通道隔离](architecture/stdout-stderr.md)：数据通道与诊断通道物理隔离，杜绝大模型解析崩溃。
- [安全加固与防御模型](architecture/security.md)：非回环认证、权限固化、常数时间比对与原型污染防护。
