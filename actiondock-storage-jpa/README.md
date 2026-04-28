# actiondock-storage-jpa

JPA 持久化适配模块，为脚本平台和 AI 工作台提供基于 Spring Data JPA + H2 的仓储实现。

## 负责范围

- `actiondock-core` 领域仓储的 JPA 适配
- `actiondock-ai-api` 领域仓储的 JPA 适配
- JPA Entity、Spring Data Repository 与 JSON 编解码
- 默认 H2 文件库的落地方式

## 包结构

- `adapter`：领域仓储到 JPA 的适配层
- `entity`：数据库实体定义
- `repo`：Spring Data Repository
- `json`：JSON 编解码支持

## 持久化对象

包括但不限于：

- 脚本与发布快照
- 执行记录与参数预设
- 调度配置
- 配置值、共享状态与访问令牌
- 插件注册与仓库定义
- AI 模型、Agent、Toolset、调用日志、运行记录和步骤

## 默认存储

默认使用 H2 文件数据库，运行时路径通常位于：

- `~/.actiondock/data/dsl-runtime*`

## 相关模块

- 核心领域见 [../actiondock-core/README.md](../actiondock-core/README.md)
- Web 启动见 [../actiondock-app-spring/README.md](../actiondock-app-spring/README.md)
