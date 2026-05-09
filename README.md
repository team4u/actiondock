# ActionDock

> 把脚本、插件、仓库分发、AI 调用和运行治理放进同一运行体系的工具平台。同一份脚本定义，可以同时被人、REST API、CLI 和 Agent 使用。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Java 21](https://img.shields.io/badge/JDK-21-green.svg)
![npm](https://img.shields.io/npm/v/actiondock.svg)

---

## ActionDock 是什么

ActionDock 做的核心事情是：

1. 你写一段脚本（Groovy 或 Python）
2. 给它定义输入输出的格式（JSON Schema）
3. 发布成不可变的快照版本
4. 然后通过管理台、REST API、CLI、定时任务、事件、AI Agent 等多种入口执行它

整个过程有完整的生命周期管理（草稿 → 发布 → 归档）、依赖声明（脚本依赖、插件依赖、AI 依赖）、版本快照和执行审计轨迹。

## 核心特性

- **统一脚本抽象** — 脚本不是一段源码，而是带 Schema、发布快照、依赖、日志和执行入口的脚本资产
- **多入口复用** — 管理台、REST API、CLI、Agent 共用同一脚本
- **仓库化协作** — 脚本、插件、AI 能力包可从仓库发现、安装、更新
- **事件源仓库资产** — 事件源可连同触发器模板、配置模板和脚本依赖一起发布、安装
- **AI 原生集成** — 脚本可暴露给 Agent，AI 辅助生成、诊断、Review
- **治理能力完整** — 内置配置值、共享状态、访问令牌、执行记录、定时任务、备份恢复
- **插件扩展** — 基于 PF4J，编写 Java 插件打包成 JAR 上传安装

## 核心数据流架构

```text
创建/编辑脚本 (DRAFT)
       ↓ 校验
       ↓ 发布
已发布快照 (PUBLISHED, 不可变)
       ↓
┌──────────────────────────────────────────┐
│              执行入口                      │
│  ┌─────┐ ┌──────┐ ┌────┐ ┌──────┐ ┌────┐ │
│  │ UI  │ │ REST │ │CLI │ │定时  │ │事件 │ │
│  │运行 │ │ API  │ │运行│ │触发  │ │触发 │ │
│  └─────┘ └──────┘ └────┘ └──────┘ └────┘ │
└──────────────────────────────────────────┘
       ↓
   脚本运行时
  ┌──────────────────────┐
  │ scripts.invoke()     │ ← 调用其他脚本
  │ plugins.invoke()     │ ← 调用插件 Action
  │ state.get/put/cas()  │ ← 读写共享状态
  │ log.info/warn/error()│ ← 输出执行日志
  │ config.get()         │ ← 读取配置值
  └──────────────────────┘
       ↓
   ExecutionRecord (执行记录，全链路审计)
```

## 快速开始

### 系统要求

JDK 21+ | Maven 3.9+（源码构建） | Node.js 18+（CLI） | Python 3.x（Python 脚本）

### 安装

```bash
# CLI 一键安装（推荐）
npm install -g actiondock
actiondock server

# 或从源码构建
git clone <repository-url>
cd action-dock
mvn -pl actiondock-app-spring -am -DskipTests spring-boot:run

# 或 Docker
docker compose up -d
```

### 验证

启动后访问 http://localhost:5177/admin/app/scripts

> 完整安装方式和第一个脚本教程请阅读 [快速开始](docs/quick-start.md)。

## 文档

| 文档 | 说明 |
|------|------|
| [用户手册](docs/user-manual.md) | 完整文档入口 |
| [快速开始](docs/quick-start.md) | 安装、启动、第一个脚本 |
| [脚本编写指南](docs/script-writing-guide.md) | Schema、运行时 API、示例 |
| [事件框架配置指南](docs/event-framework.md) | Webhook、事件源、处理器 |
| [API 参考](docs/api-reference.md) | REST API 端点与常见问题 |
| [CLI 参考](docs/cli-reference.md) | 命令行工具完整参考 |

## 技术栈

**后端**：Java 21 · Spring Boot 3.3 · Groovy 4.0 · Python 3
**前端**：React 18 · Ant Design 5 · Monaco Editor
**插件**：PF4J 3.13
**CLI**：Node.js (oclif)
**存储**：JPA / H2
**AI**：OpenAI · Anthropic · Gemini · DashScope · Ollama

## License

[MIT](LICENSE)
