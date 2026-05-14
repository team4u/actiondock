# ActionDock 用户操作手册

> ActionDock 是一套把脚本、插件、仓库分发、AI 调用和运行治理放进同一运行体系的工具平台。同一份脚本定义，可以同时被人、REST API、CLI 和 Agent 使用。

---

## 一句话理解

ActionDock 做的核心事情是：

1. 你写一段脚本（Groovy 或 Python）
2. 给它定义输入输出的格式（JSON Schema）
3. 发布成不可变的快照版本
4. 然后通过管理台、REST API、CLI、定时任务、事件、AI Agent 等多种入口执行它

整个过程有完整的生命周期管理（草稿 → 发布 → 归档）、依赖声明（脚本依赖、插件依赖、AI 依赖）、版本快照和执行审计轨迹。

## 它和普通脚本平台的区别

| 维度 | 脚本目录 + cron | 只暴露 API 的脚本服务 | ActionDock |
|------|------------------|------------------------|------------|
| 工具输入输出契约 | 通常没有 | 需要手写 DTO / 文档 | 内建 `inputSchema` / `outputSchema` |
| 草稿与发布 | 通常没有 | 依赖额外发布流程 | 内建草稿、发布快照、丢弃草稿 |
| 团队分发 | 拷文件 / Git 约定 | 重新部署服务 | 仓库发现、安装、更新、工作副本同步 |
| 插件扩展 | 零散 SDK | 常需改主服务 | PF4J 插件机制，脚本侧统一调用 |
| AI 接入 | prompt 拼接 | 需额外接工具层 | AI Toolset、Agent、脚本桥接 |
| 共享状态治理 | 落文件 / Redis 自管 | 另接状态服务 | 内建共享状态 `namespace + key + JSON + version + CAS` |
| 多入口调用 | 各写各的 | API 为主 | UI、REST、CLI、Agent 共用同一脚本 |

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

> 快速上手请阅读 [快速开始](quick-start.md)，或查看 [项目首页](../README.md) 了解项目概览。

---

## 文档目录

### 🚀 入门

- [快速开始](quick-start.md) — 安装、启动、创建并运行你的第一个脚本

### ⚡ 能力

- [脚本管理](script-management.md) — 脚本库、编辑、发布、导入导出、Fork、工作副本
- [插件管理](plugin-management.md) — 插件安装、生命周期、在脚本中调用 Action
- [Skills 管理](skills-management.md) — Skills 安装目标、安装、发布、详情，以及项目知识库用法约定
- [AI 能力](ai-capabilities.md) — 模型配置、Agent 配置、Toolset、运行记录

### 📦 资源

- [仓库与分发](repository-distribution.md) — 仓库发现、仓库管理、安装更新、发布、项目仓库解析

### ⏱️ 触发

- [触发中心](trigger-center.md) — 定时任务、Webhook、Webhook、执行记录

### ⚙️ 设置

- [系统设置](system-settings.md) — 配置值、共享状态、访问令牌、数据备份恢复

### 📖 参考

- [脚本编写指南](script-writing-guide.md) — 脚本结构、Schema、运行时 API 完整参考
- [CLI 参考](cli-reference.md) — 安装、配置、脚本命令、项目仓库解析、服务管理
- [API 参考与 FAQ](api-reference.md) — 全部端点分类、常见问题、术语表

---

> [回到项目首页](../README.md)
