# AI 能力

## 一句话理解

ActionDock 内建 AI 能力，不是外挂的 AI 功能，而是平台原生的能力层。你可以在 ActionDock 中配置多个 AI 模型供应商，定义 Agent（带 System Prompt 和工具集），然后将 Agent 暴露给脚本、API 和 CLI 调用。每次调用都有完整的步骤追踪和 Token 用量统计。

核心组件：
1. **Model Profile（模型配置）**：定义哪个供应商、哪个模型、API Key 在哪里
2. **Agent Profile（Agent 配置）**：定义 System Prompt、关联哪个模型、使用哪些工具
3. **Toolset（工具集）**：Agent 可以使用的工具集合，脚本可以暴露为工具
4. **AI 运行记录**：完整的执行轨迹、步骤追踪、Token 用量

## 架构总览

```text
调用方
  ┌───────┐ ┌──────┐ ┌───────┐ ┌────────┐
  │ 脚本   │ │ Agent│ │ 管理台  │ │ CLI    │
  │invoke()│ │内部  │ │ 测试   │ │        │
  └───┬───┘ └──┬───┘ └───┬───┘ └───┬────┘
      └────────┼─────────┼─────────┘
               ▼         ▼
       ┌──────────────┐
       │ AI 网关       │
       │ (Chat/Structured/Embed/AgentRun)
       └──────┬───────┘
              │
      ┌───────┴────────┐
      │ 模型层          │
      │ Model Profile   │
      │ ├─ DASHSCOPE   │
      │ ├─ OPENAI      │
      │ ├─ ANTHROPIC   │
      │ ├─ GEMINI      │
      │ └─ OLLAMA      │
      └───────┬────────┘
              │
      ┌───────┴────────┐
      │ 外部 AI API     │
      │ (OpenAI/Claude  │
      │  etc.)          │
      └────────────────┘
```

## 模型配置

路径：管理台 → 能力 → AI → 模型管理

模型配置（`ModelProfile`）是连接外部 AI 供应商的桥梁。

### 配置字段

| 字段 | 说明 | 示例 |
|------|------|------|
| ID | 唯一标识，供 Agent 和脚本引用 | `my-gpt4` |
| 名称 | 人类可读名称 | `GPT-4o` |
| 模型供应商 | 支持的供应商 | 见下方 |
| 模型名称 | 供应商的模型标识 | `gpt-4o`、`qwen-max`、`claude-3-opus-20240229` |
| Base URL | 自托管或兼容端点的地址（可选） | `http://localhost:11434/v1`（OLLAMA） |
| API Key 配置键 | 引用 Config Value 中的 Key 名（不是直接填 Key） | `ai.openai.key` |
| 能力 | `CHAT` / `STRUCTURED_OUTPUT` / `EMBEDDING` | `CHAT` |
| 默认选项 | JSON 格式，默认的模型参数 | `{"temperature": 0.7, "max_tokens": 2048}` |
| 限制 | JSON 格式，速率限制等 | `{"ratePerMinute": 60}` |
| 启用 | 是否启用 | 是 |

### 支持的供应商

| 供应商 ID | 说明 | 是否需要 API Key | 示例模型 |
|-----------|------|------------------|----------|
| `DASHSCOPE` | 阿里通义千问 | 是 | `qwen-max`、`qwen-plus` |
| `OPENAI` | OpenAI | 是 | `gpt-4o`、`gpt-4o-mini` |
| `OPENAI_COMPATIBLE` | OpenAI 兼容接口 | 视情况 | 自定义端点 |
| `ANTHROPIC` | Anthropic Claude | 是 | `claude-3-opus-20240229` |
| `GEMINI` | Google Gemini | 是 | `gemini-pro` |
| `OLLAMA` | 本地 Ollama | 否 | `llama3`、`qwen2:7b` |

### 关于 API Key

**API Key 不能直接填入模型配置**。需要先创建 Config Value：

1. 路径：设置 → 配置值
2. 创建一条配置：Key 为 `ai.openai.key`，Value 为实际的 API Key，勾选「Secret」
3. 然后在模型配置的「API Key 配置键」字段填入 `ai.openai.key`
4. 系统运行时通过 Config Value 解析实际的 Key

### 测试模型

配置完成后，点击「测试模型」按钮：

- 系统发送测试 Prompt 到 AI 供应商
- 返回响应结果或错误信息
- 帮助快速验证连通性

### OLLAMA 本地配置示例

```bash
# 先启动 Ollama
ollama pull qwen2:7b
ollama serve
```

模型配置字段：
- 供应商：`OLLAMA`
- 模型名称：`qwen2:7b`
- Base URL：`http://localhost:11434/v1`
- API Key 配置键：留空（OLLAMA 不需要）

## Agent 配置

路径：管理台 → 能力 → AI → Agent 管理

Agent Profile 定义了 AI 代理的行为：用什么模型、遵循什么 System Prompt、可以使用哪些工具。

### 配置字段

| 字段 | 说明 | 示例 |
|------|------|------|
| ID | 唯一标识 | `customer-service-agent` |
| 名称 | 人类可读名称 | `客服助手` |
| 描述 | 用途说明 | 处理客户咨询 |
| 模型配置 | 关联的模型（下拉选择） | `my-gpt4` |
| System Prompt | 系统提示词 | `你是一个专业的客服助手...` |
| Toolset 引用 | 关联的 Toolset（可多选） | `order-tools`, `user-tools` |
| 直接工具 | 不在 Toolset 中的额外工具名称 | `send-email` |
| Skill IDs | 加载到 Agent 上下文的 Skill | `order-processing` |
| 选项 | JSON 格式的 Agent 参数 | `{"maxToolCalls": 20}` |
| 启用 | 是否启用 | 是 |

### System Prompt 编写建议

- 定义角色和边界：`你是一个订单查询助手，只能回答与订单相关的问题`
- 指定输出格式：`请用 JSON 格式回复`
- 定义行为约束：`不确定时请说"我无法回答这个问题"`
- 引用工具能力：`你可以调用 query-order 工具查询订单状态`

### 测试 Agent

配置完成后，点击「测试 Agent」按钮：

- 输入测试消息
- 系统启动一次 Agent 运行
- 展示完整步骤追踪（模型推理 → 工具调用 → 工具结果 → ...）

## Toolset 管理

路径：管理台 → 能力 → AI → Toolset 管理

Toolset 是工具的集合，Agent 通过 Toolset 知道可以使用哪些工具。

### 配置字段

| 字段 | 说明 | 示例 |
|------|------|------|
| ID | 唯一标识 | `order-tools` |
| 名称 | 人类可读名称 | `订单工具集` |
| 描述 | 用途说明 | `查询和操作订单的工具` |
| 工具列表 | 从已注册工具中搜索选择 | `query-order`、`cancel-order` |
| 最大权限 | 工具执行的最大权限级别 | `READ_ONLY` |
| 启用 | 是否启用 | 是 |

### 权限级别

| 权限 | 说明 | 适用工具 |
|------|------|----------|
| `READ_ONLY` | 只读操作，无副作用 | 查询订单、查看用户信息 |
| `PROPOSE_CHANGE` | 可以提议修改，需要用户确认 | 编辑草稿 |
| `CONTROLLED_ACTION` | 受控操作 | 发送通知 |
| `DANGEROUS_ACTION` | 危险操作 | 删除数据、执行转账 |

### 工具来源

| 来源 | 说明 |
|------|------|
| `SYSTEM` | 平台内置工具（如执行脚本、查询共享状态） |
| `SCRIPT` | 脚本暴露的工具——已发布脚本自动注册为可调用工具 |
| `AGENT` | 自定义 Agent 级别工具 |

## 项目任务的建议

如果要回答某个业务项目里的实现、数据库、流程或 runbook 问题，建议先走项目知识入口解析，而不是直接扫源码：

1. 识别目标项目 ID
2. 调用 `actiondock repository resolve --repository-id <value>`
3. 优先阅读返回的 `ACTIONDOCK.md`
4. 按正文中列出的 Markdown 文档和关键词继续检索
5. 只有在文档不足时再读源码

这套模式的目标是让 ActionDock 只做稳定定位，真正的阅读、搜索和推理由调用方自己完成。

## AI 概览页面

路径：管理台 → 能力 → AI

概览页面展示运行状况：

| 卡片 | 内容 |
|------|------|
| 模型管理 | 已启用模型数量，未配置 API Key 警告 |
| Agent 管理 | 已启用 Agent 数量 |
| Toolset 管理 | 已启用 Toolset 数量 |
| 最近运行 | 最近 8 条 Agent 运行记录 |

## AI 运行记录

路径：管理台 → 能力 → AI → 运行记录

### 列表

| 列 | 说明 |
|----|------|
| Run ID | 运行标识（点击进入详情） |
| Agent | 使用的 Agent 配置 |
| 状态 | `RUNNING` / `SUCCESS` / `FAILED` / `WAITING_APPROVAL` / `CANCELLED` / `INTERRUPTED` |
| 调用方类型 | `SCRIPT` / `PLUGIN` / `ADMIN_TEST` / `AGENT` |
| 开始时间 | 运行开始时间 |

### 运行详情

点击 Run ID 进入详情页，展示：

**步骤追踪面板：**

每个步骤记录：

| 属性 | 说明 |
|------|------|
| 步骤类型 | `MODEL_REASONING`（模型推理）、`TOOL_CALL`（工具调用）、`TOOL_RESULT`（工具返回）、`APPROVAL`（等待审批）、`INTERRUPT`（中断） |
| 延迟 | 该步骤耗时 |
| 输入 | 步骤的输入内容 |
| 输出 | 步骤的输出内容 |
| 错误 | 如果有错误 |

**用量统计：**

- 输入 Token 数
- 输出 Token 数
- 总 Token 数

**完整对话消息：**

展示完整的消息历史，方便回溯。

## 从脚本调用 AI

通过内置系统插件 `actiondock-ai`，脚本可以直接调用 AI 能力：

```groovy
// 聊天对话
def chatResult = plugins.invoke("actiondock-ai", "chat", [
    modelProfileId: "my-model",
    messages: [
        [role: "system", content: "你是一个助手"],
        [role: "user", content: "你好"]
    ]
])

// 结构化输出（要求 AI 按指定 Schema 返回）
def structuredResult = plugins.invoke("actiondock-ai", "structured", [
    modelProfileId: "my-model",
    messages: [[role: "user", content: "从以下文本提取姓名和年龄：张三，28岁"]],
    responseSchema: [
        type: "object",
        properties: [
            name: [type: "string"],
            age: [type: "integer"]
        ]
    ]
])

// 向量嵌入
def embedResult = plugins.invoke("actiondock-ai", "embed", [
    modelProfileId: "my-embedding-model",
    input: ["文本1", "文本二"]
])

// 运行 Agent
def agentResult = plugins.invoke("actiondock-ai", "agentRun", [
    agentProfileId: "my-agent",
    input: "帮我查一下订单 O20240506001 的状态"
])
```

## REST API 直接调用 AI

```bash
# 聊天
curl -X POST http://localhost:5177/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "modelProfileId": "my-model",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# 结构化输出
curl -X POST http://localhost:5177/api/ai/structured \
  -H 'Content-Type: application/json' \
  -d '{
    "modelProfileId": "my-model",
    "messages": [{"role": "user", "content": "提取信息"}],
    "responseSchema": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer"}
      }
    }
  }'

# 向量嵌入
curl -X POST http://localhost:5177/api/ai/embed \
  -H 'Content-Type: application/json' \
  -d '{
    "modelProfileId": "my-embedding-model",
    "input": ["文本"]
  }'

# Agent 管理
curl http://localhost:5177/api/ai/agents
curl http://localhost:5177/api/ai/agents/my-agent

# 模型管理
curl http://localhost:5177/api/ai/models
curl http://localhost:5177/api/ai/models/my-model

# Toolset 管理
curl http://localhost:5177/api/ai/toolsets
curl http://localhost:5177/api/ai/toolsets/my-toolset
```

## 常见问题

### Q: 模型测试失败

1. 检查 API Key 是否已在 Config Value 中正确配置
2. 检查模型供应商的 Base URL 是否正确（OLLAMA 本地通常为 `http://localhost:11434/v1`）
3. 检查模型名称是否准确（不同供应商模型名称不同）
4. 网络是否能访问 AI 供应商的 API

### Q: OLLAMA 怎么配置

- 供应商选 `OLLAMA`
- Base URL 填 Ollama 的兼容端点地址
- API Key 留空
- 先确保 `ollama serve` 在运行

### Q: Agent 运行失败

优先检查：
1. Agent 关联的模型是否已启用且可正常调用
2. Toolset 中引用的工具是否存在且已启用
3. System Prompt 是否正确引导

### Q: 脚本如何暴露为 Agent 工具

已发布的脚本会自动注册为系统工具。在 Toolset 的工具列表中搜索脚本 ID 即可添加。

## 最佳实践

- **API Key 安全**：始终使用 Config Value 存储敏感 Key，不要硬编码
- **最小权限原则**：Toolset 的权限从 `READ_ONLY` 开始，验证后再提升
- **Agent 测试**：先在管理台测试 Agent，确认行为符合预期后再接入生产
- **System Prompt 维护**：System Prompt 是 Agent 行为的核心，应版本化管理
- **Token 监控**：通过运行记录观察 Token 用量，及时优化 Prompt 长度

---

> [返回目录](user-manual.md) | 下一步：了解 [仓库与分发](repository-distribution.md)
