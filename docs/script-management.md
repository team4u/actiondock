# 脚本管理

## 一句话理解

脚本是 ActionDock 的核心资产。一个脚本不只是一段源码——它是带有 `inputSchema`/`outputSchema`、发布快照、依赖声明和执行审计的完整可执行单元。你可以把它看作一个"微服务函数"：定义一次，到处执行。

## 脚本定义实体结构

理解脚本的数据模型有助于你更好地使用 API 和排查问题。下面是 `ScriptDefinition` 的核心字段：

```java
public class ScriptDefinition {
    private String id;                    // 唯一标识，创建后不可变更
    private String name;                  // 人类可读名称
    private ScriptType type;              // GROOVY 或 PYTHON
    private ScriptPackaging packaging;    // TOOL（工具型）或 FLOW（流程型）
    private String source;                // 脚本源代码
    private String pythonRequirements;    // Python 版 requirements.txt
    private Map<String, Object> inputSchema;   // JSON Schema 格式
    private Map<String, Object> outputSchema;  // JSON Schema 格式
    private ScriptStatus status;          // DRAFT / PUBLISHED / ARCHIVED
    private Integer version;              // 发布版本号，每次发布 +1
    private PublishedScriptSnapshot publishedSnapshot;  // 发布快照
    private ScriptScope scope;            // PERSONAL / REPOSITORY / SAMPLE
    private String repositoryId;          // 来源仓库（仓库安装脚本或工作副本）
    private String repositoryScriptId;   // 来源仓库中的脚本 ID
    private String repositoryVersion;
    private boolean editable;
    private String description;
    private List<ScriptDependency> scriptDependencies;  // 脚本间依赖
    private List<PluginDependency> pluginDependencies;   // 插件依赖
    private List<AiDependency> aiDependencies;           // AI 能力依赖
}
```

## 脚本生命周期

```text
                        ┌───────────────┐
                        │  创建脚本      │
                        │  (DRAFT)      │
                        └───────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
            ┌──────────────┐       ┌──────────────┐
            │ 编辑源码      │       │ 校验语法      │
            │ 编辑 Schema  │       │ POST /validate│
            │ 声明依赖      │       └──────┬───────┘
            └──────┬───────┘              │
                   │                      │
                   ▼                      │
            ┌──────────────┐              │
            │ 发布          │◄─────────────┘
            │ 产生不可变     │
            │ 快照 v2       │
            │ (PUBLISHED)   │
            └──────┬───────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────┐     ┌──────────────┐
│ 丢弃草稿      │     │ 编辑新草稿    │
│ (回到已发布)  │     │ 产生 v3 草稿  │
└──────────────┘     └──────────────┘
```

**关键规则：**

- 草稿（DRAFT）：可以自由编辑和调试，不影响已发布的线上版本
- 发布（PUBLISHED）：产生不可变快照（`PublishedScriptSnapshot`），被调脚本和定时任务始终走 published 版本。每次发布 `version` 自增 1
- 丢弃草稿：通过 `POST /api/scripts/{id}/discard-draft` 一键回到上次发布版本
- 已归档（ARCHIVED）状态不能发布

## 脚本库页面

路径：管理台 → 能力 → 脚本库

### 筛选条件

| 筛选维度 | 可选值 |
|----------|--------|
| **来源** | 全部 / 个人 (PERSONAL，含工作副本与 Fork 副本) / 仓库 (REPOSITORY) / 示例 (SAMPLE) |
| **状态** | 全部 / 已发布 (PUBLISHED) / 草稿 (DRAFT) / 可更新 (UPDATE_AVAILABLE) / 远程有变更 (REMOTE_CHANGES) / 已分叉 (DIVERGED) / 只读 (READ_ONLY) |
| **类型** | 全部 / Python / Groovy |

### 表格列说明

| 列 | 说明 |
|----|------|
| 脚本名称/ID | 点击进入脚本编辑器 |
| 来源/状态标签 | 显示脚本作用域（PERSONAL/REPOSITORY）和发布状态 |
| 操作 | 运行、复制 ID、导出、更新、卸载 |

### 工具栏

| 按钮 | 功能 |
|------|------|
| 刷新 | 重新加载脚本列表 |
| 一键更新 | 同步所有仓库并更新所有可更新的脚本 |
| 导出可编辑 | 批量导出个人脚本为 JSON 文件 |
| 导入脚本 | 从 JSON 文件导入脚本（支持差异预览） |
| 新建脚本 | 创建新的个人脚本 |

## 创建脚本

点击「新建脚本」，进入脚本编辑器。

### 基本信息

| 字段 | 说明 | 注意 |
|------|------|------|
| Script ID | 脚本唯一标识符 | **创建后不可修改** |
| 脚本名称 | 人类可读名称 | 如在管理台和 API 响应中显示 |
| 脚本类型 | `GROOVY` 或 `PYTHON` | 创建后不可变更 |
| 打包类型 | `TOOL`（工具型）或 `FLOW`（流程型） | 影响 UI 渲染和执行行为 |
| 描述 | 脚本用途说明 | 建议写清楚输入输出 |

**关于 Script ID 的命名建议：**

- 用小写字母和连字符，如 `send-email`、`data-transform`
- 这个 ID 会出现在 API URL、CLI 命令和依赖声明中
- 项目内保持唯一

### Schema 定义

Schema 一次声明，四处生效：

| 用途 | 说明 |
|------|------|
| CLI flag 生成 | `--name alice --age 30` 自动展平 |
| UI 表单生成 | 管理台自动渲染参数输入表单 |
| AI 工具描述 | Agent 自动识别为工具定义 |
| 执行校验 | 执行前自动校验入参格式 |

**Schema 示例：**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "用户姓名",
      "default": "world"
    },
    "age": {
      "type": "integer",
      "description": "年龄",
      "minimum": 0
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["name"]
}
```

可视化 Schema 编辑器支持：字段添加、类型选择、必填设置、嵌套对象。

### 源码编辑

使用 Monaco Editor（VS Code 编辑器核心），支持：

- Groovy 和 Python 语法高亮
- 自动补全
- 代码折叠
- 差异对比

### 依赖声明

**脚本依赖（调用其他脚本）：**

声明引用的其他脚本 ID，运行时可调用：

```groovy
// Groovy 中调用
def result = scripts.invoke("data-transform", [raw: input.data])
```

跨语言透明：Groovy 可以调用 Python 脚本，反之亦然。

**插件依赖：**

声明所需的插件 ID 和 Action，运行时确保插件已安装并启动。

```groovy
// 声明依赖后，在代码中调用
def result = plugins.invoke("my-plugin", "hello", [name: "world"])
```

**AI 依赖：**

声明所需 AI 能力类型：`CHAT`、`STRUCTURED_OUTPUT` 等。

### Python 专属

`pythonRequirements` 字段等同于 `requirements.txt`：

```
requests==2.31.0
pandas>=2.0
```

平台会自动安装到隔离缓存目录，不影响宿主环境。

## 编辑脚本

### 编辑模式

- **个人脚本（PERSONAL）**：完全可编辑，也包括仓库脚本创建出来的工作副本和 Fork 副本
- **仓库脚本（REPOSITORY）**：只读，需要先创建工作副本或 Fork 后才能编辑
- **示例脚本（SAMPLE）**：系统内置样例，通常用于参考

### 工作副本同步状态标签

对带有上游绑定的 `PERSONAL` 脚本（即工作副本），会显示同步状态标签：

| 标签 | 含义 |
|------|------|
| `SYNCED` | 本地与远程一致 |
| `LOCAL_CHANGES` | 有本地未同步修改 |
| `REMOTE_CHANGES` | 上游有新版本 |
| `DIVERGED` | 本地和上游都有修改，需要手动处理 |

## 执行脚本

### 执行入口

| 入口 | 路径/命令 |
|------|-----------|
| 管理台 | 脚本编辑器 → 「执行」标签页 |
| REST API | `POST /api/scripts/{id}/execute` |
| CLI | `actiondock script run <id> --param value` |
| 定时任务 | 触发中心 → 定时触发 |
| Webhook | 触发中心 → Webhook |

### 执行模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `SYNC` | 同步等结果返回 | 需要立即拿到输出 |
| `ASYNC` | 异步提交，立即返回记录 ID | 通知、归档、后台任务 |

### 响应视图

| 视图 | 说明 |
|------|------|
| `RESULT` | 仅返回输出结果和基本状态 |
| `DEBUG` | 包含输入、原始输出、完整日志和错误详情 |

### 执行预设

保存常用的输入参数组合：

1. 在编辑器的「执行」标签页中填入参数
2. 点击「保存为预设」
3. 下次执行时从预设下拉列表快速选择

### 执行历史

每次执行完成后自动生成执行记录（`ExecutionRecord`），包含：

| 字段 | 说明 |
|------|------|
| `id` | 执行记录唯一标识 |
| `scriptId` | 执行的脚本 |
| `status` | `PENDING` / `RUNNING` / `SUCCESS` / `FAILED` |
| `submitMode` | `SYNC` 或 `ASYNC` |
| `triggerSource` | `MANUAL` / `SCHEDULED` / `AI_TOOL` / `EVENT` |
| `input` | 实际执行入参 |
| `output` | 执行输出 |
| `logs` | 执行日志列表 |
| `errorMessage` | 错误信息 |
| `createdAt` / `startedAt` / `finishedAt` | 时间戳 |

### 通过 REST API 执行

```bash
# 同步执行
curl -X POST http://localhost:5177/api/scripts/my-script/execute \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "input": {"name": "alice"},
    "mode": "SYNC"
  }'

# 异步执行，获取调试视图
curl -X POST ... \
  -d '{
    "input": {"name": "alice"},
    "mode": "ASYNC",
    "responseView": "DEBUG"
  }'

# 执行草稿版本
curl -X POST http://localhost:5177/api/scripts/my-script/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {"name": "alice"},
    "draft": true
  }'
```

## 执行记录管理

### REST API

```bash
# 查询某脚本的执行列表
curl "http://localhost:5177/api/executions?scriptId=my-script"

# 查询执行详情
curl "http://localhost:5177/api/executions/{id}"

# 删除单条执行记录
curl -X DELETE "http://localhost:5177/api/executions/{id}"

# 清空所有执行记录
curl -X DELETE "http://localhost:5177/api/executions"
```

## 导入与导出

### 导出格式

导出的 JSON 文件格式如下：

```json
[
  {
    "scriptId": "my-script",
    "name": "My Script",
    "type": "GROOVY",
    "packaging": "TOOL",
    "source": "def result = ...",
    "inputSchema": { ... },
    "outputSchema": { ... },
    "scriptDependencies": [...],
    "pluginDependencies": [...],
    "aiDependencies": [...],
    "description": "..."
  }
]
```

### 导入流程

1. 点击「导入脚本」
2. 选择 JSON 文件
3. 如有已存在的脚本 ID，系统展示差异预览
4. 确认后导入

## Fork 仓库脚本

当你在仓库中发现一个有用的脚本但需要做定制修改时：

1. 在脚本库中找到 REPOSITORY 作用域的脚本
2. 点击「Fork」按钮
3. 输入新的 Script ID 和名称
4. Fork 后产生 `PERSONAL` 作用域的可编辑副本，独立维护

Fork 后的脚本与原始仓库脚本不再保持上游同步关系。

## 发布脚本到仓库

从脚本编辑器中选择「发布到仓库」：

1. 选择目标仓库
2. 系统将已发布的脚本快照打包发布到仓库
3. 团队其他成员同步仓库后即可看到并安装

详见 [仓库与分发](repository-distribution.md)。

## 常见问题

### Q: 保存时报"脚本已存在"

Script ID 在同一个命名空间下必须唯一。换个 ID 重试。

### Q: 执行时报"脚本尚未发布"

定时任务和Webhook只能引用已发布的脚本。先 `POST /api/scripts/{id}/publish` 发布。

### Q: 校验失败

检查：
- Groovy 语法是否正确（缺括号、类型错误）
- `inputSchema` 是否为合法的 JSON Schema
- 引用的依赖脚本是否存在且已发布

### Q: 草稿 vs 发布混淆

- 在 UI 编辑器中修改的是草稿
- 点击「运行」时默认运行的是**已发布版本**
- 在编辑器内点击「运行」运行的是**当前草稿**
- 通过 API 的 `POST /api/scripts/{id}/execute` 可以指定 `draft: true` 执行草稿

### Q: 执行结果与实际不符

脚本编辑器的「执行」标签页运行的是草稿，而定时任务和Webhook运行的是已发布版本。如果修改后没有发布，两边结果可能不同。

## 最佳实践

- **先定 Schema，再写源码**：清晰的 `inputSchema` 让 AI Agent、CLI 和 API 调用者都受益
- **草稿阶段多测试**：使用编辑器内「执行」调试草稿，通过后再发布
- **执行预设保存常用参数**：减少重复输入
- **小脚本原则**：一个脚本做好一件事，通过 `scripts.invoke()` 组合

---

> [返回目录](user-manual.md) | 下一步：了解 [插件管理](plugin-management.md)
