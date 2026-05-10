# API 参考与常见问题

## 一句话理解

ActionDock 的 REST API 以 `/api` 为前缀，使用 JSON 格式，通过 Bearer Token 认证（可配置为开放模式）。所有 API 响应用 `ApiResponse<T>` 包装，包含 `code`、`message` 和 `data` 字段。

## API 访问基础

- **Base URL**: `http://localhost:5177/api`
- **Swagger UI**: `http://localhost:5177/swagger-ui.html`
- **Content-Type**: `application/json`
- **认证**: `Authorization: Bearer <token>` 请求头
- **开放模式**: 如果没有配置任何访问令牌，所有 API 请求不需要认证

### 通用响应格式

```json
{
  "code": 200,
  "message": "操作成功",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | HTTP 状态码，200 表示成功 |
| `message` | string | 操作结果消息 |
| `data` | object/array | 响应数据结构 |

错误响应：

```json
{
  "code": 400,
  "message": "参数错误：name 不能为空",
  "data": null
}
```

## 脚本管理 API

### 脚本 CRUD

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| `GET` | `/api/scripts` | 脚本列表 | - | `ScriptDefinition[]` |
| `POST` | `/api/scripts` | 创建脚本 | `ScriptDefinition` | `ScriptDefinition` |
| `GET` | `/api/scripts/{id}` | 脚本详情（草稿） | - | `ScriptDefinition` |
| `GET` | `/api/scripts/{id}/published` | 已发布版本详情 | - | `ScriptDefinition` |
| `PUT` | `/api/scripts/{id}` | 更新脚本 | `ScriptDefinition` | `ScriptDefinition` |
| `PATCH` | `/api/scripts/{id}` | 部分更新 | `Map<String, Object>` | `ScriptDefinition` |
| `DELETE` | `/api/scripts/{id}` | 删除脚本 | - | - |

查询参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `includeUiSchema` | boolean | 是否包含 UI Schema 信息（默认为 false） |
| `includeManaged` | boolean | 是否包含托管脚本（默认为 false） |

### 脚本操作

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| `POST` | `/api/scripts/{id}/validate` | 校验语法 | - |
| `POST` | `/api/scripts/{id}/publish` | 发布草稿 | - |
| `POST` | `/api/scripts/{id}/discard-draft` | 丢弃草稿 | - |
| `POST` | `/api/scripts/{id}/execute` | 执行脚本，默认已发布；支持 `draft` | `ExecuteRequest` |
| `POST` | `/api/scripts/{id}/fork` | Fork 脚本 | `RepositoryForkRequest` |

### ExecuteRequest

```json
{
  "input": {
    "name": "alice"
  },
  "mode": "SYNC",
  "responseView": "RESULT"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `input` | object | 是 | 匹配脚本 `inputSchema` 的入参 |
| `mode` | string | 否 | `SYNC` 或 `ASYNC`，默认 `SYNC` |
| `responseView` | string | 否 | `RESULT` 或 `DEBUG`，默认 `RESULT` |

### ExecutionResponse

```json
{
  "id": "exec-xxx",
  "scriptId": "hello-groovy",
  "status": "SUCCESS",
  "submitMode": "SYNC",
  "triggerSource": "MANUAL",
  "output": {
    "greeting": "Hello, alice!",
    "timestamp": 1715000000000
  },
  "logs": [
    {
      "level": "INFO",
      "message": "开始执行",
      "timestamp": "2026-05-06T16:00:00"
    }
  ],
  "errorMessage": null,
  "errorDetail": null,
  "createdAt": "2026-05-06T16:00:00",
  "startedAt": "2026-05-06T16:00:00",
  "finishedAt": "2026-05-06T16:00:01",
  "debug": null
}
```

状态枚举：

| 值 | 说明 |
|----|------|
| `PENDING` | 等待执行 |
| `RUNNING` | 执行中 |
| `SUCCESS` | 执行成功 |
| `FAILED` | 执行失败 |

触发来源枚举：

| 值 | 说明 |
|----|------|
| `MANUAL` | 手动执行 |
| `SCHEDULED` | 定时任务触发 |
| `AI_TOOL` | AI Agent 调用 |
| `EVENT` | 事件触发 |

## 统一脚本执行入口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/scripts/{id}/execute` | 执行脚本，默认已发布；支持 `draft` 参数 |

通过该入口执行时，可以在请求中添加 `"draft": true` 执行草稿版本。

## 执行记录 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/executions` | 提交执行 |
| `GET` | `/api/executions` | 查询执行列表（需 scriptId 或 scheduleId） |
| `GET` | `/api/executions/{id}` | 执行详情 |
| `DELETE` | `/api/executions/{id}` | 删除执行 |
| `DELETE` | `/api/executions` | 清空所有执行记录 |

## 插件管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/plugins` | 插件列表 |
| `GET` | `/api/plugins/references` | 插件引用列表（编辑器用） |
| `GET` | `/api/plugins/{pluginId}` | 插件详情 |
| `GET` | `/api/plugins/{pluginId}/download` | 下载插件 JAR |
| `POST` | `/api/plugins/install` | 上传安装插件（multipart） |
| `POST` | `/api/plugins/{pluginId}/upgrade` | 升级插件（multipart） |
| `POST` | `/api/plugins/{pluginId}/start` | 启动插件 |
| `POST` | `/api/plugins/{pluginId}/stop` | 停止插件 |
| `GET` | `/api/plugins/{pluginId}/config` | 获取插件配置 |
| `PUT` | `/api/plugins/{pluginId}/config` | 保存插件配置 |

## 仓库 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/repositories` | 仓库列表 |
| `POST` | `/api/repositories` | 创建仓库 |
| `GET` | `/api/repositories/{id}` | 仓库详情 |
| `PUT` | `/api/repositories/{id}` | 更新仓库 |
| `DELETE` | `/api/repositories/{id}` | 删除仓库 |
| `POST` | `/api/repositories/{id}/sync` | 同步仓库 |
| `GET` | `/api/repositories/{id}/tools` | 列出仓库中的可用工具 |
| `POST` | `/api/repositories/{id}/tools/{toolId}/install` | 安装工具 |

## 定时任务 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/schedules` | 定时任务列表 |
| `POST` | `/api/schedules` | 创建定时任务 |
| `GET` | `/api/schedules/{id}` | 定时任务详情 |
| `PUT` | `/api/schedules/{id}` | 更新定时任务 |
| `DELETE` | `/api/schedules/{id}` | 删除定时任务 |
| `POST` | `/api/schedules/{id}/enable` | 启用 |
| `POST` | `/api/schedules/{id}/disable` | 禁用 |

## 共享状态 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/shared-state` | 查询（需 namespace 参数，可选 key） |
| `PUT` | `/api/shared-state` | 更新条目 |
| `DELETE` | `/api/shared-state` | 删除条目 |

## 配置值 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config-values` | 配置值列表 |
| `POST` | `/api/config-values` | 创建配置值 |
| `GET` | `/api/config-values/{key}` | 配置值详情 |
| `PUT` | `/api/config-values/{key}` | 更新配置值 |
| `DELETE` | `/api/config-values/{key}` | 删除配置值 |
| `GET` | `/api/config-values/{key}/impacts` | 影响分析 |

## 访问令牌 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/access-tokens` | Token 列表 |
| `POST` | `/api/access-tokens` | 创建 Token |
| `GET` | `/api/access-tokens/{id}` | Token 详情 |
| `PUT` | `/api/access-tokens/{id}` | 更新 Token |
| `DELETE` | `/api/access-tokens/{id}` | 删除 Token |
| `POST` | `/api/access-tokens/{id}/enable` | 启用 |
| `POST` | `/api/access-tokens/{id}/disable` | 禁用 |

## 事件框架 API

### 事件源

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/event-sources` | 事件源列表 |
| `POST` | `/api/event-sources` | 创建事件源 |
| `GET` | `/api/event-sources/{id}` | 事件源详情 |
| `PUT` | `/api/event-sources/{id}` | 更新事件源 |
| `POST` | `/api/event-sources/{id}/test-normalization` | 测试标准化 |
| `POST` | `/api/event-sources/{id}/events` | 接收外部事件（**不需要 Bearer Token**） |

### 事件触发

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/event-triggers` | 触发器列表 |
| `POST` | `/api/event-triggers` | 创建触发器 |
| `GET` | `/api/event-triggers/{id}` | 触发器详情 |
| `PUT` | `/api/event-triggers/{id}` | 更新触发器 |
| `POST` | `/api/event-triggers/{id}/test` | 测试触发器（不执行目标脚本） |
| `GET` | `/api/event-triggers/{id}/dispatches` | 获取分发记录 |

### 事件记录

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/event-records` | 事件记录列表 |
| `GET` | `/api/event-records/{id}` | 事件记录详情 |
| `GET` | `/api/event-records/{id}/dispatches` | 关联的分发记录 |

### 处理器

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/processors/test` | 测试处理器 |

## AI API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/ai/models` | 模型列表 |
| `POST` | `/api/ai/models` | 创建模型配置 |
| `GET` | `/api/ai/models/{id}` | 模型详情 |
| `PUT` | `/api/ai/models/{id}` | 更新模型配置 |
| `GET` | `/api/ai/agents` | Agent 列表 |
| `POST` | `/api/ai/agents` | 创建 Agent |
| `GET` | `/api/ai/agents/{id}` | Agent 详情 |
| `PUT` | `/api/ai/agents/{id}` | 更新 Agent |
| `GET` | `/api/ai/toolsets` | Toolset 列表 |
| `POST` | `/api/ai/toolsets` | 创建 Toolset |
| `GET` | `/api/ai/toolsets/{id}` | Toolset 详情 |
| `PUT` | `/api/ai/toolsets/{id}` | 更新 Toolset |
| `POST` | `/api/ai/chat` | 直接聊天调用 |
| `POST` | `/api/ai/structured` | 结构化输出 |
| `POST` | `/api/ai/embed` | 向量嵌入 |

## Skills API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/skills` | Skill 列表 |
| `GET` | `/api/skills/{id}` | Skill 详情 |

## 常见问题

### 脚本相关

**Q: 脚本校验失败**
检查：
- Schema 格式是否合法（JSON Schema Draft-07）
- 必填字段是否完整
- Groovy/Python 语法错误

**Q: 草稿执行 vs 发布执行**

| 入口 | 执行版本 |
|------|----------|
| 编辑器「执行」标签页 | 草稿 |
| API `POST /api/scripts/{id}/execute` | 已发布 |
| API `POST /api/scripts/{id}/execute` + `draft: true` | 草稿 |
| 定时任务 | 已发布 |
| 事件触发 | 已发布 |
| CLI `actiondock script run` | 已发布 |
| CLI `actiondock script run --draft` | 草稿 |

**Q: 依赖找不到**
确认被依赖的脚本已发布，插件已安装并启动。

### 插件相关

**Q: 插件启动失败**
检查：
1. JAR 是否符合 PF4J 规范
2. `META-INF/MANIFEST.MF` 中是否声明 `Plugin-Class`
3. Java 版本兼容性

**Q: 版本冲突**
更新时如果提示版本冲突，先卸载旧版本再安装新版本。

### 事件框架相关

**Q: 事件没进来**
1. 检查 Webhook 地址是否正确（`POST /api/event-sources/{id}/events`）
2. 检查鉴权配置是否匹配外部系统
3. 外部系统是否发送了 JSON

**Q: 触发器不命中**
查看事件记录中的分发状态：
- `FILTERED`：过滤处理器返回 `matched: false`
- `DUPLICATE`：幂等处理器判定为重复

**Q: 目标脚本必须已发布**
保存事件触发时，目标脚本必须是 `PUBLISHED` 状态。先发布脚本。

### AI 相关

**Q: 模型测试失败**
1. 检查 API Key 是否在 Config Value 中正确配置
2. 检查模型名称是否准确
3. 检查网络连通性

**Q: OLLAMA 不需要 API Key**
使用 OLLAMA 供应商时，API Key 配置键留空。

**Q: Agent 运行失败**
检查 Toolset 中引用的工具是否存在且已启用。

### 仓库相关

**Q: 同步失败**
检查网络连接、Git 认证、分支名。

**Q: 工作副本冲突 (`DIVERGED`)**
本地和上游都有修改。使用 `?force=true` 强制拉取，或先手工备份再重新整理本地改动。

## 术语表

| 术语 | 说明 |
|------|------|
| Script Definition | 脚本定义，包含源码、Schema、依赖等完整元数据 |
| Published Snapshot | 发布快照，脚本发布时产生的不可变版本 |
| Draft | 草稿，可自由编辑的脚本版本 |
| Scope（作用域） | `PERSONAL`（个人，含工作副本和 Fork 副本）/ `REPOSITORY`（仓库安装，只读）/ `SAMPLE`（示例） |
| Packaging（打包类型） | `TOOL`（工具型，单次调用）/ `FLOW`（流程型，可能包含多步骤） |
| Plugin | 插件，基于 PF4J 的扩展模块 |
| Repository | 仓库，脚本/插件/Skills 的分发来源 |
| Toolset | 工具集，Agent 可使用的一组工具 |
| Agent Profile | Agent 配置，定义 AI Agent 的模型、提示词、工具 |
| Model Profile | 模型配置，定义 AI 模型的供应商、名称、API Key |
| Event Source | 事件源，外部系统的 Webhook 接入口 |
| Event Trigger | 事件触发，事件到脚本的路由规则 |
| Processor | 处理器，数据转换逻辑（`JSON_PATH` / `TEMPLATE` / `SCRIPT_REF`） |
| Config Value | 配置值，全局键值配置（如 API Key） |
| Shared State | 共享状态，跨脚本的键值存储，支持 CAS 乐观锁 |
| CAS | Compare-And-Swap，乐观锁机制 |
| Access Token | 访问令牌，API Bearer Token 认证凭证 |
| Skill | 技能包，可安装到目标目录的功能包 |
| Skill Target | 技能目标，Skill 安装的目录 |
| Execution Preset | 执行预设，保存的常用输入参数组合 |
| Submit Mode | 提交模式，`SYNC`（同步等结果）/ `ASYNC`（异步提交） |
| Execution Record | 执行记录，包含执行的输入、输出、状态、日志、链路追踪 |

---

> [返回目录](user-manual.md)
