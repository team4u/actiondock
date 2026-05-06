本文档提供 Script-Flow 平台的完整 REST API 参考，涵盖脚本管理、插件系统、AI 能力、事件框架等所有功能模块的接口定义。所有 API 均采用统一的响应封装格式，支持通过 Swagger UI 进行交互式测试。

## 认证与基础配置

| 配置项 | 值 |
|--------|-----|
| Base URL | `http://localhost:5177/api` |
| Swagger UI | `http://localhost:5177/swagger-ui.html` |
| 认证方式 | `Authorization: Bearer <token>` 请求头 |
| 开放模式 | 未配置访问令牌时，所有 API 无需认证 |

### 统一响应格式

所有 API 响应均封装为 `ApiResponse<T>` 结构：

```json
{
  "status": 0,
  "msg": "处理成功",
  "data": { /* 实际数据 */ }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| status | int | 状态码，`0` 表示成功，非零表示错误 |
| msg | string | 响应消息 |
| data | T | 响应数据，类型由具体接口决定 |

Sources: [ApiResponse.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ApiResponse.java#L1-L90)

---

## 脚本管理 (`/api/scripts`)

脚本管理 API 提供脚本定义的完整生命周期管理，包括 CRUD、发布、执行和参数预设功能。

### 端点概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scripts` | 查询所有脚本定义列表 |
| POST | `/api/scripts` | 新建或更新脚本定义 |
| GET | `/api/scripts/{id}` | 查询脚本详情（草稿版本） |
| GET | `/api/scripts/{id}/published` | 查询已发布的脚本快照 |
| PUT | `/api/scripts/{id}` | 更新脚本定义 |
| PATCH | `/api/scripts/{id}` | JSON Merge Patch 部分更新 |
| DELETE | `/api/scripts/{id}` | 删除脚本定义 |
| POST | `/api/scripts/{id}/validate` | 校验脚本合法性 |
| POST | `/api/scripts/{id}/publish` | 发布脚本草稿 |
| POST | `/api/scripts/{id}/discard-draft` | 丢弃草稿，恢复发布版本 |
| POST | `/api/scripts/{id}/execute` | 执行已发布的脚本 |
| POST | `/api/scripts/{id}/execute-draft` | 执行草稿版本脚本 |

Sources: [ScriptController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ScriptController.java#L1-L250)

### 查询脚本列表

```
GET /api/scripts?includeUiSchema=true&includeManaged=false
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| includeUiSchema | boolean | false | 是否包含 UI Schema 信息 |
| includeManaged | boolean | false | 是否包含系统管理的脚本 |

### 执行脚本

```
POST /api/scripts/{id}/execute
```

**请求体 (ExecuteRequest)：**

```json
{
  "scriptId": "my-script",
  "input": { "param1": "value1" },
  "mode": "SYNC",
  "responseView": "RESULT"
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| scriptId | string | 必填 | 脚本 ID |
| input | Map | null | 输入参数 |
| mode | SubmitMode | SYNC | 执行模式：`SYNC`（同步）/ `ASYNC`（异步） |
| responseView | ExecutionResponseView | RESULT | 响应视图：`RESULT` / `DEBUG` / `FULL` |

Sources: [ExecuteRequest.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ExecuteRequest.java#L1-L50)

### 脚本执行预设 (`/api/scripts/{scriptId}/presets`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scripts/{scriptId}/presets` | 查询脚本的所有参数预设 |
| POST | `/api/scripts/{scriptId}/presets` | 创建参数预设 |
| PUT | `/api/scripts/{scriptId}/presets/{presetId}` | 更新参数预设 |
| DELETE | `/api/scripts/{scriptId}/presets/{presetId}` | 删除参数预设 |

Sources: [ExecutionPresetController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ExecutionPresetController.java#L1-L97)

---

## 能力统一入口 (`/api/capabilities`)

能力 API 是脚本能力的统一入口，提供与脚本管理相同的操作接口，支持草稿执行等高级功能。

### 端点概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/capabilities` | 查询所有能力列表 |
| GET | `/api/capabilities/{id}` | 查询能力详情 |
| POST | `/api/capabilities` | 创建能力 |
| PUT | `/api/capabilities/{id}` | 更新能力 |
| PATCH | `/api/capabilities/{id}` | 部分更新能力 |
| DELETE | `/api/capabilities/{id}` | 删除能力 |
| POST | `/api/capabilities/{id}/validate` | 校验能力 |
| POST | `/api/capabilities/{id}/publish` | 发布能力 |
| POST | `/api/capabilities/{id}/discard-draft` | 丢弃草稿 |
| POST | `/api/capabilities/{id}/execute` | 执行能力（支持 draft 参数） |

### 执行能力

```
POST /api/capabilities/{id}/execute
```

**请求体 (CapabilityExecuteRequest)：**

```json
{
  "draft": false,
  "input": { "key": "value" },
  "mode": "SYNC",
  "responseView": "RESULT"
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| draft | boolean | false | 是否执行草稿版本（true 执行草稿，false 执行发布版本） |
| input | Map | null | 输入参数 |
| mode | SubmitMode | SYNC | 执行模式 |
| responseView | ExecutionResponseView | RESULT | 响应视图 |

Sources: [CapabilityController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/CapabilityController.java#L1-L125)

---

## 执行记录 (`/api/executions`)

执行记录 API 提供脚本执行历史的管理功能。

### 端点概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/executions` | 提交脚本执行 |
| GET | `/api/executions/{id}` | 查询执行记录详情 |
| GET | `/api/executions` | 查询执行记录列表 |
| DELETE | `/api/executions/{id}` | 删除指定执行记录 |
| DELETE | `/api/executions` | 清空执行记录 |

### 查询执行记录

```
GET /api/executions?scriptId=xxx
GET /api/executions?scheduleId=xxx
```

**说明：** `scriptId` 和 `scheduleId` 必须提供其一。

Sources: [ExecutionController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ExecutionController.java#L1-L112)

---

## 插件管理 (`/api/plugins`)

插件 API 基于 PF4J 框架，提供插件的安装、启停、配置和调用功能。

### 端点概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 查询所有已安装插件 |
| GET | `/api/plugins/references` | 查询可用插件参考 |
| GET | `/api/plugins/{pluginId}` | 查询插件详情 |
| GET | `/api/plugins/{pluginId}/download` | 下载插件 JAR 文件 |
| POST | `/api/plugins/install` | 上传安装插件 |
| POST | `/api/plugins/{pluginId}/upgrade` | 升级插件 |
| POST | `/api/plugins/{pluginId}/start` | 启动插件 |
| POST | `/api/plugins/{pluginId}/stop` | 停止插件 |
| GET | `/api/plugins/{pluginId}/config` | 查询插件配置 |
| PUT | `/api/plugins/{pluginId}/config` | 保存插件配置 |
| POST | `/api/plugins/{pluginId}/actions/{action}/invoke` | 调试调用插件动作 |
| DELETE | `/api/plugins/{pluginId}` | 卸载插件 |

### 安装插件

```
POST /api/plugins/install
Content-Type: multipart/form-data

file: <插件JAR文件>
```

### 调试调用插件动作

```
POST /api/plugins/{pluginId}/actions/{action}/invoke
```

**请求体 (PluginInvokeRequest)：**

```json
{
  "args": { "actionParam": "value" },
  "scriptInput": { "scriptContext": "data" },
  "responseView": "DEBUG"
}
```

Sources: [PluginController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/PluginController.java#L1-L202)

---

## 仓库管理 (`/api/repositories`)

仓库 API 提供仓库定义的 CRUD、工具同步、安装和发布功能。

### 端点概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/repositories` | 查询所有仓库 |
| POST | `/api/repositories` | 创建仓库 |
| PUT | `/api/repositories/{id}` | 更新仓库 |
| DELETE | `/api/repositories/{id}` | 删除仓库 |
| POST | `/api/repositories/{id}/sync` | 同步仓库工具 |
| GET | `/api/repositories/tools` | 查询所有仓库工具 |
| GET | `/api/repositories/{id}/tools` | 查询仓库工具列表 |
| GET | `/api/repositories/{id}/tools/{toolId}` | 查询工具详情 |
| POST | `/api/repositories/{id}/tools/{toolId}/install` | 安装工具 |
| POST | `/api/repositories/{id}/tools/{toolId}/update` | 更新工具 |
| POST | `/api/repositories/{id}/tools/{toolId}/develop` | 同步为开发脚本 |
| POST | `/api/repositories/{id}/publish` | 发布工具到仓库 |
| GET | `/api/repositories/plugins` | 查询所有仓库插件 |
| GET | `/api/repositories/{id}/plugins` | 查询仓库插件列表 |
| POST | `/api/repositories/{id}/plugins/{pluginId}/install` | 安装仓库插件 |
| POST | `/api/repositories/{id}/plugins/{pluginId}/update` | 更新仓库插件 |
| GET | `/api/repositories/skills` | 查询所有仓库 Skills |
| GET | `/api/repositories/{id}/skills` | 查询仓库 Skills 列表 |
| GET | `/api/repositories/{id}/skills/{skillId}/archive` | 下载 Skill 归档 |
| POST | `/api/repositories/{id}/skills/{skillId}/install` | 安装 Skill |
| GET | `/api/repositories/packages` | 查询所有能力包 |
| GET | `/api/repositories/{id}/packages` | 查询仓库能力包 |
| POST | `/api/repositories/{id}/packages/{packageId}/install` | 安装能力包 |
| POST | `/api/repositories/{id}/packages/{packageId}/update` | 更新能力包 |

### 安装工具

```
POST /api/repositories/{id}/tools/{toolId}/install
```

**请求体 (RepositoryInstallRequest)：**

```json
{
  "installSchedules": false,
  "installScriptDependencies": true,
  "installPluginDependencies": true,
  "forcePluginUpgrade": false
}
```

Sources: [RepositoryController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/RepositoryController.java#L1-L343)

---

## 定时任务 (`/api/schedules`)

调度 API 提供全局定时任务的管理功能。

### 端点概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schedules` | 查询所有定时任务 |
| GET | `/api/schedules/{scheduleId}` | 查询定时任务详情 |
| POST | `/api/schedules` | 创建定时任务 |
| PUT | `/api/schedules/{scheduleId}` | 更新定时任务 |
| POST | `/api/schedules/{scheduleId}/enable` | 启用定时任务 |
| POST | `/api/schedules/{scheduleId}/disable` | 停用定时任务 |
| DELETE | `/api/schedules/{scheduleId}` | 删除定时任务 |

### 脚本维度调度 (`/api/scripts/{scriptId}/schedules`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scripts/{scriptId}/schedules` | 查询脚本的定时任务 |
| POST | `/api/scripts/{scriptId}/schedules` | 创建脚本定时任务 |
| PUT | `/api/scripts/{scriptId}/schedules/{scheduleId}` | 更新脚本定时任务 |
| POST | `/api/scripts/{scriptId}/schedules/{scheduleId}/enable` | 启用脚本定时任务 |
| POST | `/api/scripts/{scriptId}/schedules/{scheduleId}/disable` | 停用脚本定时任务 |
| DELETE | `/api/scripts/{scriptId}/schedules/{scheduleId}` | 删除脚本定时任务 |

Sources: [ScheduleController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ScheduleController.java#L1-L72)
Sources: [ScriptScheduleController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ScriptScheduleController.java#L1-L61)

---

## 事件框架

事件框架 API 提供事件源管理、事件接收、触发规则和事件记录功能。

### 事件源 (`/api/event-sources`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/event-sources` | 查询所有事件源 |
| GET | `/api/event-sources/{id}` | 查询事件源详情 |
| POST | `/api/event-sources` | 创建事件源 |
| PUT | `/api/event-sources/{id}` | 更新事件源 |
| DELETE | `/api/event-sources/{id}` | 删除事件源 |
| POST | `/api/event-sources/{id}/enable` | 启用事件源 |
| POST | `/api/event-sources/{id}/disable` | 停用事件源 |
| POST | `/api/event-sources/{id}/test-normalization` | 测试事件标准化 |
| GET | `/api/event-sources/{id}/events` | 查询事件源的事件记录 |

Sources: [EventSourceController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/EventSourceController.java#L1-L86)

### 事件接收 (`/api/event-sources/{id}/events`)

**Webhook 接收端点，接收外部系统的事件推送：**

```
POST /api/event-sources/{id}/events
Content-Type: application/json
```

此端点不需要认证（除非配置了额外的鉴权），支持自动提取 HTTP 请求头、查询参数和请求体作为事件数据。

Sources: [EventIngestionController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/EventIngestionController.java#L1-L68)

### 事件触发 (`/api/event-triggers`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/event-triggers` | 查询所有触发规则 |
| GET | `/api/event-triggers/{id}` | 查询触发规则详情 |
| POST | `/api/event-triggers` | 创建触发规则 |
| PUT | `/api/event-triggers/{id}` | 更新触发规则 |
| DELETE | `/api/event-triggers/{id}` | 删除触发规则 |
| POST | `/api/event-triggers/{id}/enable` | 启用触发规则 |
| POST | `/api/event-triggers/{id}/disable` | 停用触发规则 |
| POST | `/api/event-triggers/{id}/test` | 测试触发规则 |
| GET | `/api/event-triggers/{id}/dispatches` | 查询触发分发记录 |

### 事件记录 (`/api/event-records`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/event-records` | 查询所有事件记录 |
| GET | `/api/event-records/{id}` | 查询事件记录详情 |
| GET | `/api/event-records/{id}/dispatches` | 查询事件的触发分发记录 |

Sources: [EventTriggerController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/EventTriggerController.java#L1-L74)
Sources: [EventRecordController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/EventRecordController.java#L1-L40)

---

## 配置与状态管理

### 配置值 (`/api/config-values`)

全局配置值 API 提供键值配置的 CRUD 和模板管理功能。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config-values` | 查询所有配置值 |
| GET | `/api/config-values/{key}` | 查询配置值详情（含使用分析） |
| POST | `/api/config-values` | 创建配置值 |
| PUT | `/api/config-values/{key}` | 更新配置值 |
| POST | `/api/config-values/{key}/copy-local-override` | 复制为本地覆盖值 |
| POST | `/api/config-values/{key}/restore-repository-default` | 恢复仓库默认值 |
| DELETE | `/api/config-values/{key}` | 删除配置值 |

Sources: [ConfigValueController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ConfigValueController.java#L1-L115)

### 共享状态 (`/api/shared-state`)

共享状态 API 提供跨脚本的键值存储，支持 CAS 乐观锁机制。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/shared-state/namespaces` | 查询所有命名空间 |
| GET | `/api/shared-state` | 查询命名空间下的状态列表 |
| GET | `/api/shared-state/detail` | 查询状态详情 |
| POST | `/api/shared-state` | 创建或更新状态 |
| PUT | `/api/shared-state` | 更新状态 |
| POST | `/api/shared-state/cas` | CAS 原子更新 |
| DELETE | `/api/shared-state` | 删除状态 |
| POST | `/api/shared-state/purge-expired` | 清理过期状态 |

**CAS 原子更新请求：**

```json
{
  "namespace": "my-namespace",
  "key": "counter",
  "expectedVersion": 5,
  "value": 6,
  "secret": false,
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| namespace | string | 命名空间 |
| key | string | 状态键 |
| expectedVersion | long | 期望的当前版本（用于 CAS） |
| value | object | 新值 |
| secret | boolean | 是否加密存储 |
| expiresAt | string | 过期时间（ISO 8601） |

Sources: [SharedStateController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/SharedStateController.java#L1-L129)

---

## 访问令牌 (`/api/access-tokens`)

访问令牌 API 管理 API 认证凭证。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/access-tokens` | 查询所有访问令牌 |
| POST | `/api/access-tokens` | 创建访问令牌 |
| PUT | `/api/access-tokens/{id}` | 重命名访问令牌 |
| POST | `/api/access-tokens/{id}/enable` | 启用访问令牌 |
| POST | `/api/access-tokens/{id}/disable` | 停用访问令牌 |
| DELETE | `/api/access-tokens/{id}` | 删除访问令牌 |

**创建访问令牌：**

```
POST /api/access-tokens
{"name": "My API Token"}
```

返回包含 `tokenValue`（完整令牌，仅此时可见）和 `tokenPreview`（令牌预览）。

Sources: [AccessTokenController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/AccessTokenController.java#L1-L79)

---

## Skills 管理 (`/api/skills`)

Skills API 提供功能包的安装、更新和目标管理功能。

### Skill 操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills` | 查询所有已安装 Skills |
| GET | `/api/skills/{skillId}` | 查询 Skill 详情 |
| GET | `/api/skills/{skillId}/detail` | 查询 Skill 详细信息 |
| GET | `/api/skills/{skillId}/archive` | 导出 Skill 归档 |
| GET | `/api/skills/{skillId}/preview` | 预览 Skill 文件 |
| POST | `/api/skills/import` | 从 ZIP 导入 Skill |
| POST | `/api/skills/validate` | 验证 Skill 包 |
| POST | `/api/skills/package` | 打包目录为 Skill |
| POST | `/api/skills/install-directory` | 从目录安装 Skill |
| POST | `/api/skills/github/scan` | 扫描 GitHub 仓库 |
| POST | `/api/skills/github/install` | 从 GitHub 安装 |
| POST | `/api/skills/install-archive` | 安装归档文件 |
| POST | `/api/skills/{skillId}/update` | 更新 Skill |
| POST | `/api/skills/{skillId}/version` | 更新 Skill 版本 |
| POST | `/api/skills/{skillId}/disable` | 停用 Skill |
| POST | `/api/skills/{skillId}/restore` | 恢复 Skill |
| DELETE | `/api/skills/{skillId}` | 卸载 Skill |
| DELETE | `/api/skills/{skillId}/targets/{targetId}` | 从目标移除 Skill |

### Skill 目标 (`/api/skill-targets`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skill-targets` | 查询所有 Skill 目标 |
| POST | `/api/skill-targets` | 创建 Skill 目标 |
| PUT | `/api/skill-targets/{targetId}` | 更新 Skill 目标 |
| DELETE | `/api/skill-targets/{targetId}` | 删除 Skill 目标 |
| POST | `/api/skill-targets/{targetId}/scan` | 扫描目标目录 |
| GET | `/api/skill-targets/{targetId}/scan/{directoryId}` | 查询扫描项详情 |
| GET | `/api/skill-targets/{targetId}/scan/{directoryId}/preview` | 预览扫描文件 |
| DELETE | `/api/skill-targets/{targetId}/scan/{directoryId}` | 删除扫描目录 |
| POST | `/api/skill-targets/{targetId}/sync-installations` | 同步 Skill 安装 |

Sources: [SkillController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/SkillController.java#L1-L160)
Sources: [SkillTargetController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/SkillTargetController.java#L1-L83)

---

## AI 能力

AI 模块提供模型配置、Agent 运行和直接 AI 调用功能。

### AI 网关 (`/api/ai`)

提供直接的 AI 模型调用接口。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/chat` | 聊天对话 |
| POST | `/api/ai/structured` | 结构化输出 |
| POST | `/api/ai/embed` | 向量嵌入 |

**聊天请求 (AiChatRequest)：**

```json
{
  "modelId": "gpt-4",
  "messages": [
    {"role": "system", "content": "你是助手"},
    {"role": "user", "content": "你好"}
  ],
  "options": { "temperature": 0.7 }
}
```

Sources: [AiGatewayController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ai/AiGatewayController.java#L1-L42)

### AI 模型 (`/api/ai/models`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/models` | 查询所有模型配置 |
| POST | `/api/ai/models` | 创建模型配置 |
| GET | `/api/ai/models/{id}` | 查询模型详情 |
| PUT | `/api/ai/models/{id}` | 更新模型配置 |
| DELETE | `/api/ai/models/{id}` | 删除模型配置 |
| POST | `/api/ai/models/{id}/test` | 测试模型连接 |

Sources: [AiModelController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ai/AiModelController.java#L1-L67)

### AI Agent (`/api/ai/agents`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/agents` | 查询所有 Agent 配置 |
| POST | `/api/ai/agents` | 创建 Agent 配置 |
| GET | `/api/ai/agents/{id}` | 查询 Agent 详情 |
| PUT | `/api/ai/agents/{id}` | 更新 Agent 配置 |
| DELETE | `/api/ai/agents/{id}` | 删除 Agent 配置 |
| POST | `/api/ai/agents/{id}/test` | 测试 Agent |

### Agent 运行时 (`/api/ai/agents/...`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/agents/run` | 运行 Agent |
| POST | `/api/ai/agents/runs` | 提交 Agent 运行 |
| GET | `/api/ai/agents/runs` | 查询运行记录 |
| GET | `/api/ai/agents/runs/{runId}` | 查询运行详情 |
| POST | `/api/ai/agents/runs/{runId}/resume` | 恢复运行 |
| POST | `/api/ai/agents/runs/{runId}/cancel` | 取消运行 |
| DELETE | `/api/ai/agents/runs/{runId}` | 删除运行记录 |

Sources: [AiAgentController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ai/AiAgentController.java#L1-L54)
Sources: [AiAgentRuntimeController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ai/AiAgentRuntimeController.java#L1-L75)

### AI 工具集 (`/api/ai/toolsets`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/toolsets` | 查询所有工具集 |
| POST | `/api/ai/toolsets` | 创建工具集 |
| GET | `/api/ai/toolsets/{id}` | 查询工具集详情 |
| PUT | `/api/ai/toolsets/{id}` | 更新工具集 |
| DELETE | `/api/ai/toolsets/{id}` | 删除工具集 |

Sources: [AiToolsetController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ai/AiToolsetController.java#L1-L54)

### AI 工具 (`/api/ai/tools`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/tools` | 查询所有可用工具 |
| GET | `/api/ai/tools/{name}` | 查询工具详情 |
| POST | `/api/ai/tools/{name}/test` | 测试工具执行 |

Sources: [AiToolController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ai/AiToolController.java#L1-L52)

### AI 调用日志 (`/api/ai/calls`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/calls` | 查询 AI 调用记录 |

Sources: [AiCallLogController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ai/AiCallLogController.java#L1-L27)

---

## 其他端点

### Schema (`/api/schema`)

```
GET /api/schema/{id}
```

查询脚本的输入输出模式摘要信息。

Sources: [SchemaController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/SchemaController.java#L1-L53)

### 处理器测试 (`/api/processors`)

```
POST /api/processors/test
```

测试数据处理器（JSON_PATH / TEMPLATE / SCRIPT_REF）的执行效果。

Sources: [ProcessorController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ProcessorController.java#L1-L48)

### 资源生命周期 (`/api/resource-lifecycle`)

统一资源生命周期操作 facade，支持仓库工具、仓库插件和能力包的统一管理。

```
POST /api/resource-lifecycle/operations
```

**请求体：**

```json
{
  "resourceType": "REPOSITORY_TOOL",
  "repositoryId": "repo-id",
  "resourceId": "tool-id",
  "operation": "install",
  "payload": {}
}
```

Sources: [ResourceLifecycleController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/ResourceLifecycleController.java#L1-L186)

### 已安装工具 (`/api/installed-tools`)

| 方法 | 路径 | 说明 |
|------|------|------|
| DELETE | `/api/installed-tools/{scriptId}` | 卸载已安装的仓库工具 |

Sources: [InstalledToolController.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/InstalledToolController.java#L1-L29)

---

## 错误处理

### 错误响应格式

```json
{
  "status": 500,
  "msg": "错误描述",
  "data": null
}
```

### 常见 HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未认证或认证失败 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### 校验错误响应

校验失败时返回 400 状态码，data 字段包含详细的字段错误信息。

Sources: [GlobalExceptionHandler.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/web/GlobalExceptionHandler.java)

---

## 快速开始示例

### 1. 执行脚本（同步模式）

```bash
curl -X POST http://localhost:5177/api/scripts/my-script/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "input": {"message": "Hello"},
    "mode": "SYNC"
  }'
```

### 2. 查询脚本列表

```bash
curl http://localhost:5177/api/scripts?includeUiSchema=true \
  -H "Authorization: Bearer your-token"
```

### 3. 调用 AI 聊天

```bash
curl -X POST http://localhost:5177/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "modelId": "my-model",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 4. 接收 Webhook 事件

```bash
curl -X POST http://localhost:5177/api/event-sources/github-webhook/events \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -d '{"ref": "refs/heads/main", "commits": []}'
```

---

## 相关文档

- [CLI 命令参考](18-cli-ming-ling-can-kao) — 了解命令行工具的使用方法
- [脚本编写指南](user-manual.md#脚本编写指南) — 学习如何编写高质量的脚本
- [插件开发指南](7-cha-jian-kai-fa-zhi-nan) — 开发自定义插件扩展
- [AI 模型配置](9-ai-mo-xing-pei-zhi) — 配置 AI 模型供应商
- [事件触发规则](13-shi-jian-hong-fa-gui-ze) — 配置事件到脚本的路由