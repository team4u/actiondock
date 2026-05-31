# API 参考与常见问题

## 一句话理解

ActionDock 的 REST API 以 `/api` 为前缀，绝大多数接口使用 JSON 格式，通过 Bearer Token 认证（可配置为开放模式）。Webhook 接收接口 `POST /api/webhooks/{id}` 是例外：它不要求平台级 Bearer Token，且请求体既可以是 JSON 对象，也可以是原始字符串。当前版本的 Webhook 语义是“一个固定地址对应一个脚本，请求和响应都由脚本自行处理”。

## API 访问基础

- **Base URL**: `http://localhost:5177/api`
- **Swagger UI**: `http://localhost:5177/swagger-ui.html`
- **Content-Type**: 默认使用 `application/json`；Webhook 接收接口 `POST /api/webhooks/{id}` 也支持 `text/plain` 等原始字符串请求体
- **认证**: `Authorization: Bearer <token>` 请求头
- **开放模式**: 如果没有配置任何访问令牌，所有 API 请求不需要认证

### 通用响应格式

```json
{
  "status": 0,
  "msg": "处理成功",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | int | 业务状态，成功固定为 `0`，错误时与 HTTP 状态码一致 |
| `msg` | string | 操作结果消息 |
| `data` | object/array | 响应数据结构 |

错误响应：

```json
{
  "status": 404,
  "msg": "插件不存在: workspace",
  "data": {
    "code": "PLUGIN_NOT_FOUND",
    "pluginId": "workspace"
  }
}
```

错误响应的 `data.code` 是稳定错误码，前端和 CLI 应优先依赖它而不是解析 `msg`。HTTP API 异常不会返回 Java 异常类型或完整堆栈；完整堆栈只写入服务端日志。

常见状态码：

| HTTP 状态码 | 说明 |
|-------------|------|
| `400` | 请求参数、请求体或输入校验失败 |
| `401` | 访问令牌缺失或无效 |
| `404` | 请求的脚本、执行记录、插件、配置值等资源不存在 |
| `409` | 资源状态冲突、版本冲突、资源已存在或当前操作不允许 |
| `413` / `431` | Webhook 请求体或请求头超限 |
| `500` | 未预期的服务端错误，响应 `data.code` 为 `INTERNAL_ERROR` |

### 通用 list 意图搜索

业务资产列表接口支持 `intent` 查询参数。`intent` 是正则表达式，服务端在资产摘要字段中匹配；正则不合法时返回 `400`。CLI 的 `--intent` 会在服务端空命中时自动退回全量列表，REST API 本身只返回当前查询结果。

适用接口：

- `GET /api/scripts`
- `GET /api/plugins`
- `GET /api/repositories`
- `GET /api/repositories/scripts`
- `GET /api/repositories/{id}/scripts`
- `GET /api/repositories/webhooks`
- `GET /api/repositories/{id}/webhooks`
- `GET /api/repositories/playbooks`
- `GET /api/repositories/{id}/playbooks`
- `GET /api/repositories/plugins`
- `GET /api/repositories/{id}/plugins`
- `GET /api/repositories/knowledge`
- `GET /api/repositories/{id}/knowledge`
- `GET /api/webhooks`
- `GET /api/schedules`
- `GET /api/scripts/{scriptId}/schedules`
- `GET /api/scripts/{scriptId}/presets`
- `GET /api/config-values`
- `GET /api/playbooks`

## 脚本管理 API

### 脚本 CRUD

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| `GET` | `/api/scripts` | 脚本列表，支持 `intent` 正则过滤 | - | `ScriptDefinition[]` |
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
| `WEBHOOK` | Webhook 触发 |

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
| `GET` | `/api/plugins` | 插件摘要列表（含 `actionCount`，不含 action schema），支持 `intent` 正则过滤 |
| `GET` | `/api/plugins/references` | 插件引用列表（编辑器用，含 action schema） |
| `GET` | `/api/plugins/{pluginId}` | 插件详情（含 action schema） |
| `GET` | `/api/plugins/{pluginId}/download` | 下载插件 JAR |
| `POST` | `/api/plugins/install` | 上传安装插件（multipart） |
| `POST` | `/api/plugins/{pluginId}/upgrade` | 升级插件（multipart） |
| `POST` | `/api/plugins/{pluginId}/start` | 启动插件 |
| `POST` | `/api/plugins/{pluginId}/stop` | 停止插件 |
| `GET` | `/api/plugins/{pluginId}/config` | 获取默认插件配置 |
| `PUT` | `/api/plugins/{pluginId}/config` | 保存默认插件配置 |
| `GET` | `/api/plugins/{pluginId}/configs` | 列出插件配置（含默认配置） |
| `GET` | `/api/plugins/{pluginId}/configs/{configName}` | 获取命名插件配置 |
| `PUT` | `/api/plugins/{pluginId}/configs/{configName}` | 保存命名插件配置 |
| `DELETE` | `/api/plugins/{pluginId}/configs/{configName}` | 删除命名插件配置 |
| `POST` | `/api/plugins/{pluginId}/actions/{action}/invoke` | 调试调用插件动作，body 可传 `configName` 选择命名配置 |

## 仓库 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/repositories` | 仓库列表，支持 `purpose` 和 `intent` 过滤 |
| `POST` | `/api/repositories` | 创建仓库 |
| `GET` | `/api/repositories/{id}` | 仓库详情 |
| `PUT` | `/api/repositories/{id}` | 更新仓库 |
| `DELETE` | `/api/repositories/{id}` | 删除仓库 |
| `GET` | `/api/repositories/resolve?repositoryId={value}` | 解析项目仓库并返回 `ACTIONDOCK.md` 原文 |
| `POST` | `/api/repositories/{id}/sync` | 同步仓库 |
| `GET` | `/api/repositories/scripts` | 列出所有仓库中的可用工具，支持 `intent` 正则过滤 |
| `GET` | `/api/repositories/{id}/scripts` | 列出仓库中的可用工具，支持 `intent` 正则过滤 |
| `POST` | `/api/repositories/{id}/scripts/{scriptId}/local-assets` | 添加仓库脚本到本地 |
| `POST` | `/api/repositories/{id}/scripts/{scriptId}/local-assets/update` | 更新本地仓库脚本 |
| `GET` | `/api/repositories/knowledge` | 列出所有仓库的知识源，支持 `intent` 正则过滤 |
| `GET` | `/api/repositories/{id}/knowledge` | 列出单仓库知识源，支持 `intent` 正则过滤 |
| `GET` | `/api/repositories/{id}/knowledge/{knowledgeId}` | 知识源详情 |
| `POST` | `/api/repositories/{id}/knowledge/{knowledgeId}/install` | 安装知识源 |
| `DELETE` | `/api/repositories/{id}/knowledge/{knowledgeId}` | 卸载知识源 |

### RepositoryDefinition

```json
{
  "id": "billing-service",
  "name": "Billing Service",
  "type": "LOCAL_DIR",
  "purpose": "PROJECT",
  "url": "/Users/code/projects/billing-service",
  "enabled": true,
  "trustLevel": "UNTRUSTED"
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `type` | 访问方式：`GIT` / `HTTP` / `LOCAL_DIR` |
| `purpose` | 仓库用途：`CAPABILITY` / `PROJECT` |

### 项目仓库解析响应

```json
{
  "repositoryId": "billing-service",
  "type": "LOCAL_DIR",
  "purpose": "PROJECT",
  "root": "/Users/code/projects/billing-service",
  "entryPath": "ACTIONDOCK.md",
  "enabled": true,
  "exists": true,
  "content": "# Billing Service\n\n## 优先阅读\n\n1. `overview.md`\n..."
}
```

说明：

- `repositoryId` 查询参数传项目仓库 ID
- 该接口只做定位和读取，不会触发仓库同步
- `content` 是 `ACTIONDOCK.md` 的原始 Markdown 内容

## 定时任务 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/schedules` | 定时任务列表，支持 `intent` 正则过滤 |
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
| `GET` | `/api/config-values` | 配置值列表，支持 `intent` 正则过滤 |
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

## Webhook API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/webhooks` | Webhook 列表，支持 `intent` 正则过滤 |
| `POST` | `/api/webhooks` | 创建 Webhook |
| `GET` | `/api/webhooks/{id}` | Webhook 详情 |
| `PUT` | `/api/webhooks/{id}` | 更新 Webhook |
| `DELETE` | `/api/webhooks/{id}` | 删除 Webhook |
| `POST` | `/api/webhooks/{id}/enable` | 启用 Webhook |
| `POST` | `/api/webhooks/{id}/disable` | 停用 Webhook |
| `POST` | `/api/webhooks/{id}/test-webhook` | Dry-run Webhook 脚本 |
| `POST` | `/api/webhooks/{id}` | 调用固定 Webhook 地址（不需要 Bearer Token） |

### Webhook 发布到仓库

Webhook 发布和预览走统一资源生命周期入口，而不是单独的 `/api/webhooks/{id}/publish` 路径。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/resource-lifecycle/operations` | 预览或发布 Webhook 到仓库 |

请求体示例：

```json
{
  "kind": "repositoryWebhookPublishPreview",
  "payload": {
    "sourceId": "order-created",
    "repositoryId": "team-tools",
    "scriptDependencies": [
      {
        "scriptId": "shared-helper",
        "repositoryId": "team-tools",
        "repositoryScriptId": "shared-helper",
        "versionRange": "^1.0.0"
      }
    ]
  }
}
```

发布时把 `kind` 改为 `repositoryWebhookPublish`，并在 `payload` 中补充：

- `webhookId`：要发布的本地 Webhook ID
- `displayName`、`version`、`owner`、`releaseNotes`、`tags`
- `configItems`：配置模板项
- `publishScriptDependencies`：是否连同依赖脚本一起发布
- `force`：是否覆盖版本/上游冲突校验

预览响应除配置模板外，还会返回 `dependencyDrafts`，用于提示每个 `scripts.invoke(...)` 依赖是：

- `AUTO`：可自动映射到目标仓库脚本
- `MANUAL`：需要显式指定仓库脚本 ID 或版本范围
- `UNRESOLVED`：当前无法解析，发布会失败

如果 `publishScriptDependencies=true`，服务端会按脚本发布流程递归检查并优先发布被 Webhook 绑定脚本依赖的其他脚本；未解析的依赖或非字面量 `scripts.invoke(...)` 仍会阻止发布。

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
| Webhook | 已发布 |
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

### Webhook 相关

**Q: Webhook 没进来**
1. 检查 Webhook 地址是否正确（`POST /api/webhooks/{id}`）
2. 检查 Webhook 是否绑定了已发布脚本
3. 检查脚本是否返回了合法的 `status`
4. 如果需要验签或幂等，在 Webhook 脚本里用配置值和共享状态实现

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
| Repository | 仓库，脚本/插件/Skills/知识源 的分发来源 |
| Knowledge Source | 知识源，CAPABILITY 仓库中指向外部知识仓库的指针，安装后注册为 PROJECT 仓库 |
| Toolset | 工具集，Agent 可使用的一组工具 |
| Agent Profile | Agent 配置，定义 AI Agent 的模型、提示词、工具 |
| Model Profile | 模型配置，定义 AI 模型的供应商、名称、API Key |
| Webhook | 外部系统的固定 HTTP 接入口，一个 Webhook 绑定一个已发布脚本 |
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
