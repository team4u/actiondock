# CLI Manifest 规范

## 1. 概述

CLI Manifest 是一份 JSON 文档，由后端 `/api/cli/manifest` 端点生成，描述后端 API 如何映射为 CLI 命令。CLI 侧通过通用执行器消费这份清单，实现「声明即命令」——无需为每个 API 端点手写独立的命令类。

设计原则：

- **OpenAPI 做 HTTP 契约，Manifest 做命令语义**：Manifest 不重复描述 HTTP 细节，只补充 CLI 特有的命令结构、参数映射和输出格式。
- **混合模式**：稳定命令在 CLI 发布时内嵌一份默认 Manifest（构建期生成）；运行时连接后端后可拉取最新版本。
- **白名单机制**：只有被 Manifest 声明的端点才暴露为 CLI 命令。
- **通用执行内核**：一个 `GeneratedCommand` 基类 + 统一的 `bindCliInputToHttpRequest` 适配器替代 80%+ 的手写命令。

## 2. Manifest JSON Schema

### 2.1 顶层结构

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CliManifest",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "commands"],
  "properties": {
    "schemaVersion": {
      "type": "integer",
      "const": 1,
      "description": "Manifest 格式版本号，当前为 1。破坏性变更时递增。"
    },
    "buildTimestamp": {
      "type": "string",
      "format": "date-time",
      "description": "Manifest 构建时间（ISO 8601），用于缓存校验和调试。"
    },
    "serverVersion": {
      "type": "string",
      "description": "生成此 Manifest 的后端版本（对应 pom.xml version）。"
    },
    "commands": {
      "type": "array",
      "items": { "$ref": "#/$defs/CommandDescriptor" },
      "description": "CLI 命令描述列表。"
    }
  }
}
```

### 2.2 CommandDescriptor

```json
{
  "$defs": {
    "CommandDescriptor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "topic", "action", "description", "http"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$",
          "description": "命令唯一标识，格式为 '{topic}-{action}'，如 'script-list', 'config-value-set'。"
        },
        "topic": {
          "type": "string",
          "description": "命令主题（对应 oclif topic 目录），如 'script', 'config-value', 'plugin'。"
        },
        "action": {
          "type": "string",
          "description": "命令动作名（对应 topic 下的文件名），如 'list', 'get', 'run'。"
        },
        "aliases": {
          "type": "array",
          "items": { "type": "string" },
          "description": "命令别名列表。"
        },
        "description": {
          "type": "string",
          "description": "命令的中文描述，显示在 `--help` 输出中。"
        },
        "deprecated": {
          "type": "boolean",
          "default": false,
          "description": "标记命令已废弃。CLI 侧应显示废弃警告但仍执行。"
        },
        "deprecationMessage": {
          "type": "string",
          "description": "废弃提示信息（如建议使用哪个替代命令）。"
        },
        "http": {
          "$ref": "#/$defs/HttpBinding",
          "description": "HTTP 请求绑定，描述如何将 CLI 输入转为 HTTP 请求。"
        },
        "args": {
          "type": "array",
          "items": { "$ref": "#/$defs/ArgDescriptor" },
          "description": "位置参数定义。"
        },
        "flags": {
          "type": "array",
          "items": { "$ref": "#/$defs/FlagDescriptor" },
          "description": "命名参数（flags）定义，不含全局通用 flags（json/output-file/overwrite-output/server/token/profile）。"
        },
        "output": {
          "$ref": "#/$defs/OutputDescriptor",
          "description": "输出渲染配置。省略时使用通用 JSON 渲染。"
        },
        "preconditions": {
          "type": "array",
          "items": { "$ref": "#/$defs/Precondition" },
          "description": "执行前需要满足的条件（如需要特定参数、需要先查询等）。"
        }
      }
    }
  }
}
```

### 2.3 HttpBinding

```json
{
  "$defs": {
    "HttpBinding": {
      "type": "object",
      "additionalProperties": false,
      "required": ["method", "path"],
      "properties": {
        "method": {
          "type": "string",
          "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"],
          "description": "HTTP 方法。"
        },
        "path": {
          "type": "string",
          "description": "请求路径模板，支持 {paramName} 占位符。如 '/api/scripts/{id}'。"
        },
        "pathParams": {
          "type": "array",
          "items": { "type": "string" },
          "description": "路径参数名列表，按出现顺序排列。值从 args 或 flags 中提取。"
        },
        "queryParams": {
          "type": "array",
          "items": { "$ref": "#/$defs/QueryParamBinding" },
          "description": "查询参数绑定。"
        },
        "bodyKind": {
          "type": "string",
          "enum": ["none", "json", "form-multipart"],
          "default": "none",
          "description": "请求体类型：none（GET/DELETE）、json（标准 JSON body）、form-multipart（文件上传）。"
        },
        "bodyTemplate": {
          "type": "object",
          "description": "JSON body 模板。键为输出 JSON 字段名，值为绑定表达式或字面量。"
        },
        "unwrapEnvelope": {
          "type": "boolean",
          "default": true,
          "description": "是否解包 ApiResponse<T> 信封。为 true 时，只返回 data 字段给 CLI。"
        }
      }
    }
  }
}
```

### 2.4 QueryParamBinding

```json
{
  "$defs": {
    "QueryParamBinding": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string",
          "description": "查询参数名（HTTP 侧名称）。"
        },
        "source": {
          "type": "string",
          "enum": ["flag", "arg", "literal"],
          "default": "flag",
          "description": "值来源：从同名 flag 取值、从 arg 取值、使用固定字面值。"
        },
        "sourceName": {
          "type": "string",
          "description": "当 source 为 flag/arg 时，指定取值的 flag/arg 名称。省略时等于 name。"
        },
        "defaultValue": {
          "description": "当来源值为空时的默认值。"
        },
        "omitWhenDefault": {
          "type": "boolean",
          "default": true,
          "description": "当值等于 defaultValue 时省略该查询参数。"
        }
      }
    }
  }
}
```

### 2.5 ArgDescriptor

```json
{
  "$defs": {
    "ArgDescriptor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z][a-zA-Z0-9]*$",
          "description": "位置参数名，camelCase 格式。"
        },
        "description": {
          "type": "string",
          "description": "参数中文描述。"
        },
        "required": {
          "type": "boolean",
          "default": true,
          "description": "是否必填。"
        }
      }
    }
  }
}
```

### 2.6 FlagDescriptor

```json
{
  "$defs": {
    "FlagDescriptor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "type"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$",
          "description": "Flag 名称，kebab-case 格式，如 'script-id', 'intent', 'force'。"
        },
        "char": {
          "type": "string",
          "pattern": "^[a-zA-Z]$",
          "description": "短参数字符，如 'h' 对应 -h。"
        },
        "description": {
          "type": "string",
          "description": "Flag 中文描述。"
        },
        "type": {
          "type": "string",
          "enum": ["string", "boolean", "number", "integer", "enum"],
          "description": "参数类型。"
        },
        "required": {
          "type": "boolean",
          "default": false,
          "description": "是否必填。"
        },
        "options": {
          "type": "array",
          "items": { "type": "string" },
          "description": "当 type 为 enum 时的可选值列表。"
        },
        "default": {
          "description": "默认值。"
        },
        "multiple": {
          "type": "boolean",
          "default": false,
          "description": "是否允许多值（逗号分隔或重复 flag）。"
        },
        "binding": {
          "$ref": "#/$defs/FlagBinding",
          "description": "此 flag 如何映射到 HTTP 请求中。省略时按 name 自动映射。"
        }
      }
    }
  }
}
```

### 2.7 FlagBinding

```json
{
  "$defs": {
    "FlagBinding": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "enum": ["path", "query", "body", "header", "ignore"],
          "default": "auto",
          "description": "此 flag 值放入 HTTP 请求的哪个位置。'ignore' 表示仅用于客户端逻辑（如 --all）。'auto' 由执行器根据 HttpBinding 自动判断。"
        },
        "targetName": {
          "type": "string",
          "description": "目标字段名。省略时等于 flag 的 name。用于 CLI kebab-case 到 HTTP camelCase 的映射。"
        },
        "transform": {
          "type": "string",
          "enum": ["none", "uppercase", "lowercase", "boolean-to-string"],
          "default": "none",
          "description": "简单的值变换。如 SubmitMode 的 sync -> SYNC 使用 uppercase。"
        }
      }
    }
  }
}
```

### 2.8 OutputDescriptor

```json
{
  "$defs": {
    "OutputDescriptor": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "type": "string",
          "enum": ["list", "detail", "raw", "void"],
          "description": "输出渲染类型：list=列表渲染, detail=详情渲染, raw=原始JSON, void=无输出数据。"
        },
        "entityType": {
          "type": "string",
          "description": "实体类型标识，用于选择对应的渲染函数。如 'ScriptDefinition', 'WebhookDefinition', 'ExecutionResponse'。对应现有 render.ts 中的类型。"
        },
        "columns": {
          "type": "array",
          "items": { "$ref": "#/$defs/ColumnDescriptor" },
          "description": "list 模式的列定义。"
        },
        "fields": {
          "type": "array",
          "items": { "$ref": "#/$defs/FieldDisplay" },
          "description": "detail 模式的字段显示配置。"
        },
        "successMessage": {
          "type": "string",
          "description": "void 模式下的成功提示模板。支持 {id} 等占位符。"
        }
      }
    }
  }
}
```

### 2.9 ColumnDescriptor / FieldDisplay / Precondition

```json
{
  "$defs": {
    "ColumnDescriptor": {
      "type": "object",
      "additionalProperties": false,
      "required": ["field", "label"],
      "properties": {
        "field": {
          "type": "string",
          "description": "数据字段路径，支持点号嵌套（如 'publication.published'）。"
        },
        "label": {
          "type": "string",
          "description": "列标题。"
        },
        "transform": {
          "type": "string",
          "enum": ["none", "boolean-tag", "datetime", "truncate"],
          "description": "显示变换。boolean-tag 将 true/false 显示为 published/draft-only。"
        }
      }
    },
    "FieldDisplay": {
      "type": "object",
      "additionalProperties": false,
      "required": ["field", "label"],
      "properties": {
        "field": { "type": "string" },
        "label": { "type": "string" },
        "transform": {
          "type": "string",
          "enum": ["none", "json", "datetime", "code-block", "mask-secret"]
        },
        "whenNull": {
          "type": "string",
          "description": "值为空时的显示文本。"
        }
      }
    },
    "Precondition": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind"],
      "properties": {
        "kind": {
          "type": "string",
          "enum": ["fetch-schema", "intent-fallback", "resolve-script"],
          "description": "前置条件类型。"
        },
        "params": {
          "type": "object",
          "description": "前置条件参数。如 intent-fallback 需要 { intentFlag: 'intent' }。"
        }
      }
    }
  }
}
```

## 3. 版本管理机制

### 3.1 schemaVersion

- 当前版本：`1`
- 递增规则：仅当 Manifest 的顶层结构发生破坏性变更时递增（如删除必填字段、更改字段语义）。
- CLI 侧必须在拉取 Manifest 后校验 `schemaVersion`，不兼容时拒绝使用并提示升级 CLI。

### 3.2 兼容性保证

在 `schemaVersion` 不变的前提下，后端只允许做以下兼容性变更：

- 新增命令（commands 数组追加元素）
- 新增可选 flag
- 新增查询参数
- 修改 description 文本
- 修改 output 渲染配置

不允许：

- 删除或重命名已有命令
- 删除或重命名已有 flag/arg
- 更改 HTTP 方法和路径模板（应新增命令）
- 更改 bodyTemplate 的必填字段

### 3.3 CLI 版本与 Manifest 版本的关系

- CLI 内嵌一份 `default-manifest.json`，对应 CLI 发布时后端的版本。
- CLI 在运行时连接后端后，可以拉取最新的 Manifest。
- 如果后端版本比 CLI 内嵌版本新，CLI 使用后端提供的 Manifest（可能包含新命令）。
- 如果后端版本比 CLI 版本旧，CLI 使用内嵌版本并忽略后端不识别的命令。

## 4. 示例 Manifest（5 个典型命令）

### 4.1 示例 1：script list — 标准 GET 列表

```json
{
  "id": "script-list",
  "topic": "script",
  "action": "list",
  "description": "列出可用脚本",
  "http": {
    "method": "GET",
    "path": "/api/scripts",
    "queryParams": [
      { "name": "intent" },
      { "name": "includeManaged", "source": "flag", "sourceName": "all", "defaultValue": false }
    ]
  },
  "flags": [
    {
      "name": "all",
      "type": "boolean",
      "description": "包含未发布的脚本",
      "binding": { "target": "query", "targetName": "includeManaged" }
    },
    {
      "name": "intent",
      "type": "string",
      "description": "按意图关键词过滤列表"
    }
  ],
  "preconditions": [
    { "kind": "intent-fallback", "params": { "intentFlag": "intent" } }
  ],
  "output": {
    "kind": "list",
    "entityType": "ScriptDefinition",
    "columns": [
      { "field": "id", "label": "ID" },
      { "field": "name", "label": "名称", "whenNull": "(unnamed)" },
      { "field": "type", "label": "类型" },
      { "field": "publication.published", "label": "状态", "transform": "boolean-tag" }
    ]
  }
}
```

### 4.2 示例 2：script get — 路径参数 GET

```json
{
  "id": "script-get",
  "topic": "script",
  "action": "get",
  "description": "查看脚本详情",
  "args": [
    { "name": "scriptId", "description": "脚本 ID" }
  ],
  "http": {
    "method": "GET",
    "path": "/api/scripts/{id}",
    "pathParams": ["scriptId"],
    "queryParams": [
      { "name": "draft", "source": "flag", "sourceName": "draft" }
    ]
  },
  "flags": [
    {
      "name": "draft",
      "type": "boolean",
      "description": "查看草稿版本"
    }
  ],
  "output": {
    "kind": "detail",
    "entityType": "ScriptDefinition",
    "fields": [
      { "field": "id", "label": "ID" },
      { "field": "name", "label": "名称" },
      { "field": "type", "label": "类型" },
      { "field": "description", "label": "描述" },
      { "field": "publication.published", "label": "已发布", "transform": "boolean-tag" },
      { "field": "publication.dirty", "label": "有未发布变更", "transform": "boolean-tag" },
      { "field": "inputSchema", "label": "输入 Schema", "transform": "json" },
      { "field": "source", "label": "源码", "transform": "code-block" }
    ]
  }
}
```

### 4.3 示例 3：config-value set — PUT with JSON body

```json
{
  "id": "config-value-set",
  "topic": "config-value",
  "action": "set",
  "description": "设置配置值",
  "args": [
    { "name": "key", "description": "配置键名" }
  ],
  "http": {
    "method": "PUT",
    "path": "/api/config-values/{key}",
    "pathParams": ["key"],
    "bodyKind": "json",
    "bodyTemplate": {
      "key": "{args.key}",
      "value": "{flags.value}",
      "description": "{flags.description}",
      "secret": "{flags.secret}"
    }
  },
  "flags": [
    { "name": "value", "type": "string", "required": true, "description": "配置值" },
    { "name": "description", "type": "string", "description": "配置说明" },
    { "name": "secret", "type": "boolean", "description": "标记为敏感值" }
  ],
  "output": {
    "kind": "detail",
    "entityType": "ConfigValueView",
    "fields": [
      { "field": "key", "label": "键" },
      { "field": "value", "label": "值", "transform": "mask-secret" },
      { "field": "description", "label": "说明" },
      { "field": "secret", "label": "敏感", "transform": "boolean-tag" },
      { "field": "managed", "label": "托管", "transform": "boolean-tag" }
    ]
  }
}
```

### 4.4 示例 4：schedule create — POST with dynamic input (schema-driven)

```json
{
  "id": "schedule-create",
  "topic": "schedule",
  "action": "create",
  "description": "创建定时调度",
  "http": {
    "method": "POST",
    "path": "/api/schedules",
    "bodyKind": "json",
    "bodyTemplate": {
      "scriptId": "{flags.script-id}",
      "name": "{flags.schedule-name}",
      "cronExpression": "{flags.schedule-cron}",
      "input": "{dynamicInput}",
      "enabled": "{flags.schedule-enabled}"
    }
  },
  "flags": [
    { "name": "script-id", "type": "string", "required": true, "description": "目标脚本 ID" },
    { "name": "schedule-name", "type": "string", "required": true, "description": "调度名称" },
    { "name": "schedule-cron", "type": "string", "required": true, "description": "Cron 表达式" },
    { "name": "schedule-enabled", "type": "boolean", "description": "创建后立即启用" },
    { "name": "schedule-disabled", "type": "boolean", "description": "创建后保持禁用" },
    { "name": "input-json", "type": "string", "description": "调度输入参数的 JSON 对象" },
    { "name": "input-file", "type": "string", "description": "包含调度输入参数的 JSON 文件路径" }
  ],
  "preconditions": [
    {
      "kind": "resolve-script",
      "params": { "scriptIdFlag": "script-id" }
    },
    {
      "kind": "fetch-schema",
      "params": { "scriptIdRef": "precondition.resolve-script.scriptId" }
    }
  ],
  "output": {
    "kind": "detail",
    "entityType": "ScriptScheduleView",
    "fields": [
      { "field": "id", "label": "ID" },
      { "field": "scriptId", "label": "脚本 ID" },
      { "field": "name", "label": "名称" },
      { "field": "cronExpression", "label": "Cron 表达式" },
      { "field": "enabled", "label": "已启用", "transform": "boolean-tag" },
      { "field": "nextRunAt", "label": "下次执行", "transform": "datetime" }
    ]
  }
}
```

### 4.5 示例 5：script run — 动态 Schema 驱动的执行命令

```json
{
  "id": "script-run",
  "topic": "script",
  "action": "run",
  "description": "执行脚本",
  "args": [
    { "name": "scriptId", "description": "脚本 ID" }
  ],
  "http": {
    "method": "POST",
    "path": "/api/scripts/{id}/execute",
    "pathParams": ["scriptId"],
    "bodyKind": "json",
    "bodyTemplate": {
      "input": "{dynamicInput}",
      "mode": "{flags.mode}",
      "responseView": "{flags.response-view}",
      "draft": "{flags.draft}"
    }
  },
  "flags": [
    { "name": "draft", "type": "boolean", "description": "执行草稿版本" },
    {
      "name": "mode",
      "type": "enum",
      "options": ["sync", "async"],
      "default": "sync",
      "description": "提交模式",
      "binding": { "transform": "uppercase" }
    },
    {
      "name": "response-view",
      "type": "enum",
      "options": ["result", "debug"],
      "default": "result",
      "description": "响应详细度",
      "binding": { "transform": "uppercase" }
    },
    { "name": "input-json", "type": "string", "description": "脚本输入参数的 JSON 对象" },
    { "name": "input-file", "type": "string", "description": "包含脚本输入参数的 JSON 文件路径" }
  ],
  "preconditions": [
    { "kind": "fetch-schema", "params": { "scriptIdArg": "scriptId", "useDraft": "flags.draft" } }
  ],
  "output": {
    "kind": "detail",
    "entityType": "ExecutionResponse",
    "fields": [
      { "field": "id", "label": "执行 ID" },
      { "field": "status", "label": "状态" },
      { "field": "output", "label": "输出", "transform": "json" },
      { "field": "errorMessage", "label": "错误" },
      { "field": "createdAt", "label": "创建时间", "transform": "datetime" },
      { "field": "finishedAt", "label": "完成时间", "transform": "datetime" }
    ]
  }
}
```

## 5. 设计决策说明

| 决策 | 理由 |
|------|------|
| 不嵌入 OpenAPI 规范 | OpenAPI 描述 HTTP 契约，CLI 需要「命令语义」（哪个 flag 映射到哪个参数、输出如何渲染），这层信息 OpenAPI 无法表达。两者互补而非替代。 |
| bodyTemplate 使用占位符 | 避免硬编码 body 结构，支持灵活的参数到 body 字段映射。`{dynamicInput}` 是特殊占位符，表示由 inputSchema 驱动的动态输入。 |
| pathParams 独立声明 | 路径参数从 args 或 flags 中提取，声明式映射比正则解析路径模板更可靠。 |
| preconditions 用于 schema-driven 命令 | `script run`、`schedule create`、`plugin invoke` 等命令需要先拉取 schema 再构建输入，用 precondition 声明式描述这一流程。 |
| output 按 entityType 复用渲染器 | 同一实体类型在不同命令中共享渲染逻辑（script list 和 script get 都渲染 ScriptDefinition），减少重复。 |
| 不支持 sub-resource 嵌套 topic | oclif 使用扁平的 topic 目录结构（`script/preset-create.ts` 而非 `script/preset/create.ts`），Manifest 的 topic/action 映射与此对齐。 |
