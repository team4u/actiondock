---
name: generate-script
description: 根据业务需求生成 ScriptFlow 的 Groovy 脚本及输入输出 Schema
---

# Generate Script for ScriptFlow

根据用户描述的业务需求，生成：
1. **脚本 ID**
2. **脚本名称**
3. **Groovy 脚本代码**
4. **Input Schema（输入参数定义）**
5. **Output Schema（输出结果定义）**

## 项目上下文

ScriptFlow 是一个 Groovy 脚本执行平台，脚本通过 `input` 对象访问输入参数，返回值作为 `output`。

### 脚本规范

```groovy
// input 是 Map 类型，访问参数用 input.字段名 或 input["字段名"]
def name = input.name
def age = input.age

// 脚本逻辑...

// 返回值必须是 Map，作为 output
return [
    field1: value1,
    field2: value2
]
```

### 支持的字段类型

在 Schema 中使用以下 JSON Schema 类型：

| kind | 说明 | 示例 |
|------|------|------|
| string | 字符串 | `{"type": "string"}` |
| number | 浮点数 | `{"type": "number"}` |
| integer | 整数 | `{"type": "integer"}` |
| boolean | 布尔值 | `{"type": "boolean"}` |
| enum | 枚举（字符串下拉） | `{"type": "string", "enum": ["A", "B"]}` |

### UI 扩展（可选）

字符串字段可以指定 widget：
```json
{
  "name": {"type": "string", "title": "姓名"},
  "description": {
    "type": "string",
    "title": "描述",
    "x-ui": {"widget": "textarea", "rows": 4}
  }
}
```

## 工作流程

1. **理解需求**：分析用户描述的业务逻辑，明确输入参数和输出结果
2. **反问确认**：如果需求不明确，主动询问：
    - 输入参数有哪些？（名称、类型、是否必填）
    - 输出字段有哪些？
    - 是否有特殊逻辑需要处理？
3. **生成代码**：按照规范生成脚本和 Schema
4. **说明使用**：简要说明如何部署和使用

## 生成原则

- 脚本代码简洁清晰，添加必要的注释
- Schema 中的 `title` 字段用于前端显示标签
- 必填字段放在 `required` 数组中
- 返回值使用 Map 字面量 `[:]` 语法
- 合理使用 Groovy 语法糖（如闭包、with 等）


## 输出格式

按顺序输出以下 5 段固定格式，要求：
- 标题、文案必须保持完全一致，便于前端自动解析
- `脚本 ID` 与 `脚本名称` 段落正文使用纯文本，不要放进代码块
- `Groovy 脚本`、`Input Schema（输入参数）`、`Output Schema（输出结果）` 必须各自只包含一个对应语言的代码块
- 不要在这 5 段中间插入额外标题，仅保留示例中的5个标题
- 这 5 段都是必需的，不能省略

### 脚本 ID

hello-groovy

### 脚本名称

Hello Groovy

### Groovy 脚本

```groovy
// 脚本代码
```

### Input Schema（输入参数）

```json
{
  "type": "object",
  "properties": {
    // 字段定义
  },
  "required": ["必需字段"]
}
```

### Output Schema（输出结果）

```json
{
  "type": "object",
  "properties": {
    // 字段定义
  }
}
```

