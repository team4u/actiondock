# Project: ScriptFlow 代码注释规范化

**Last updated:** 2026-04-22 after initialization

## What This Is

ScriptFlow 是一个脚本执行平台，支持 Groovy 脚本的编写、验证和执行。项目采用 DDD 架构，包含核心域模型、应用服务、Spring Boot Web 层和 JPA 持久化层。

当前代码库约 108 个 Java 文件，部分文件缺少专业的 Javadoc 注释。本项目的目标是为所有主要代码添加符合 Java 规范的专业注释。

## Core Value

提升代码可维护性和团队协作效率，通过标准化注释让新成员快速理解代码意图。

## Context

**技术栈：**
- Java 17+
- Spring Boot 3.x
- JPA/Hibernate (scriptflow-storage-jpa)
- Groovy 脚本引擎

**架构层次：**
1. **Domain Layer** (`scriptflow-core/domain/`) - 核心业务模型和领域逻辑
2. **Application Layer** (`scriptflow-core/application/`) - 应用服务和用例编排
3. **Port Layer** (`scriptflow-core/domain/port/`) - 抽象接口定义
4. **Plugin API** (`scriptflow-plugin-api/`) - 插件扩展点
5. **Web Layer** (`scriptflow-app-spring/`) - REST API 控制器
6. **Storage Layer** (`scriptflow-storage-jpa/`) - JPA 持久化实现

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 注释语言选择中文 | 团队主要使用中文 | 已确认 |
| Javadoc 标准格式 | 与现有注释风格保持一致 | 已确认 |
| 仅注释主要类和方法 | 避免注释噪音 | 待确认 |

## Requirements

### Active

- [ ] COMMENT-01: 为 Domain 层所有实体类添加 Javadoc 注释
- [ ] COMMENT-02: 为 Application 层服务类添加方法级注释
- [ ] COMMENT-03: 为 Port 层接口添加注释
- [ ] COMMENT-04: 为 Web 层控制器添加 API 注释
- [ ] COMMENT-05: 为 Storage 层实体和适配器添加注释

### Out of Scope

- 注释 getter/setter 方法（除非有业务含义）
- 注释私有辅助方法（除非复杂逻辑）

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
