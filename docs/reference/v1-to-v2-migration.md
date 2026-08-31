# 参考手册：1.0 到 2.0 架构对比与迁移指南

ActionDock 2.0 完成了向现代化、轻量化、Agent 原生架构的全面重构。

---

## 核心架构维度对比

| 架构维度 | ActionDock 1.0 (旧版) | ActionDock 2.0 (全新工具链) |
| :--- | :--- | :--- |
| **技术栈与运行时** | Java / Spring Boot / JVM | **TypeScript 原生 / Bun 原生运行时** |
| **架构定位** | 中心化微服务网关平台 | **分布式 AI Agent 工具链与独立编译器** |
| **工具定义形态** | 基于 Java 注解 / Spring Controller | **`defineAction` + JSON Schema 代码即契约** |
| **分发与交付** | 部署庞大的 Spring 容器或 War 包 | **单文件零依赖独立二进制 (`ac build`) + Agent Skill** |
| **测试与验证** | 启动庞大的 Spring 上下文 (>10s) | **纯内存毫秒级沙箱测试 (`createTestRuntime`, <5ms)** |
| **协议与生态** | 私有 REST / WebSocket 协议 | **原生 MCP 标准 (STDIO/HTTP) + AI Agent Skill 规范** |
| **持久化后端** | 外部 MySQL / PostgreSQL 依赖 | **轻量内嵌式 SQLite (`bun:sqlite`) 零运维** |

---

## 迁移指导

1. **工具逻辑迁移**：将旧版 Java 业务逻辑重构为基于 `@actiondock/sdk` 的 TypeScript `defineAction` 声明。
2. **入参映射**：将 Java DTO 注解转换为标准的 JSON Schema。
3. **配置迁移**：将 `application.yml` 中的配置项迁移至 `actiondock.json` 与 SQLite 配置库。
