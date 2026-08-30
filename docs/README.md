# ActionDock 2.0 文档索引

欢迎查阅 ActionDock 2.0 官方文档体系。按使用场景选择阅读路径：

---

## 核心开发与快速入门

| 文档 | 简介 | 目标读者 |
| :--- | :--- | :--- |
| **[项目 README](../README.md)** | 项目介绍、安装方式与上手概览 | 所有人（入口） |
| **[快速上手指南](quick-start.md)** | 从环境准备、脚手架、Action 编写、调试、编译到 Skill 导出全流程 | 新手与使用者 |
| **[Skill 设计哲学与交付指南](skill-guide.md)** | Action/Playbook/Skill 三层关系、构成规范、交叉导出与 Agent 生命周期 | 所有开发者与 Agent 架构师 |
| **[Action 编写与开发指南](action-authoring.md)** | `defineAction` 声明、TypeScript 接口、JSON Schema 校验与单测 | Action 编写者 |
| **[ActionContext 核心能力详解](action-context.md)** | `ctx.config`、`ctx.state`、`ctx.actions` 与 `ctx.log` 深度剖析 | Action 编写者 |

---

## 规程、存储与分发机制

| 文档 | 简介 | 目标读者 |
| :--- | :--- | :--- |
| **[Playbook SOP 编写指南](playbook-guide.md)** | 面向 AI Agent 的领域任务操作规程规范与校验 | 提示词/流程设计者 |
| **[存储与状态管理机制](storage-and-state.md)** | 基于 `bun:sqlite` 的 Config、State、Runs 数据模型与路径隔离 | 架构师与系统开发者 |
| **[多环境与云机器调度指南](remote-and-profiles.md)** | Profile 管理、`ac serve` 轻量 Runner 与多云节点执行 | 运维与系统开发者 |
| **[构建编译与 Skill 分发](build-and-export.md)** | `Bun.build` 单文件编译原理、交叉编译与 Skill 导出目录结构 | 交付与运维工程师 |
| **[AI Agent 接入与集成指南](agent-integration.md)** | Antigravity、Claude Code、Cursor 等主流 Agent 框架接入 | Agent 开发者 |

---

## 工具参考、排错与演进

| 文档 | 简介 | 目标读者 |
| :--- | :--- | :--- |
| **[CLI 命令参考手册 (`ac`)](cli-reference.md)** | 全量 CLI 命令、参数选项、过滤规则与退出码说明 | 所有 CLI 使用者 |
| **[测试与验证指南](testing-guide.md)** | `createTestRuntime` 内存测试、集成测试与独立编译契约测试 | 测试与质量保证 |
| **[错误代码与排错手册](error-codes.md)** | 标准运行时错误码定义、常见触发原因与排查修复建议 | 排错与日常使用 |
| **[1.0 到 2.0 迁移指南](v1-to-v2-migration.md)** | 1.0 服务端/Java 平台与 2.0 Bun 独立工具链概念映射 | 历史用户 |
| **[2.0 架构设计全量文档](architecture.md)** | ActionDock 2.0 的完整重构架构、设计哲学与约束边界 | 框架贡献者 |
| **[ActionDock AI Agent 技能指南](../skills/actiondock/SKILL.md)** | 专门面向 AI 编程助手与自主 Agent 的开发规范与元信息 | AI Agent |
