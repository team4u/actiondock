---
name: actiondock-project-knowledge-searcher
description: 当用户询问业务相关问题时使用，如查询业务的日志、数据库、代码、业务流程，提供项目知识库。适用于需要了解某个业务项目的架构、数据表、接口、流程文档等场景。
---

# ActionDock 项目知识库

## 基本原则

处理项目相关问题时，必须先获取项目知识入口，不要直接假设项目结构。

`ACTIONDOCK.md` 是每个项目的知识入口文件，由项目维护者编写，包含项目文档的阅读指引。

## 标准流程

### 1. 查看可用脚本

触发 `actiondock-cli` 技能，先列出所有可用的已发布脚本：

```bash
actiondock script list
```

同时阅读 cli 技能中的 `references/script-execution.md` 和 `references/project-knowledge.md`，了解脚本执行方式和项目知识库解析方式。

### 2. 选择合适的脚本

浏览脚本列表，思考当前任务需要哪些脚本协助完成。常见的辅助脚本包括：

- MySQL 数据库查询：`query-mysql-json` — 查询业务数据、数据表结构
- 日志查询：`log-query-vip` — 查询业务日志
- 更多脚本：根据 `script list` 输出的实际脚本列表，从功能描述中判断哪些能辅助当前任务

### 3. 查看脚本入参

对于上一步选中的脚本，逐个查看其输入参数 schema：

```bash
actiondock script schema <script-id>
```

重点关注：
- Flag fields：可直接通过 `--name value` 传入的简单参数
- JSON-only fields：需要通过 `--input-json` / `--input-file` 传入的复杂参数
- 依赖的外部上下文：如 `idTree`、`dbType`、`domain` 等，这些参数经常需要从项目知识库中获取

### 4. 针对性地搜索知识库内容

务必使用 `references/project-knowledge.md` 中的指引，根据第 3 步确定的脚本入参，有针对性地搜索项目文档

## 边界场景

- `repository resolve` 返回 `exists: false`：提示用户该项目仓库未注册或本地路径不存在，建议先同步仓库
- `ACTIONDOCK.md` 不存在或为空：说明项目未配置知识入口，只能基于源码推断，并在回答中标注"未找到项目文档"
- 用户未指定目标项目：先通过 `repository list` 列出可用项目，请用户确认

## 回答要求

回答项目问题时，说明参考了哪些项目文档或文件。

如果信息不足，明确说明缺少哪些项目文档或上下文。