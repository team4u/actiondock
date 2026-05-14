# 脚本作者态闭环

从业务需求出发，生成脚本并完成创建草稿→校验→调试→Patch→循环修复→发布的完整闭环。

如果脚本需求涉及 `plugins.invoke(...)`、`scripts.invoke(...)` 或 `actiondock-ai`，补读 `references/script-runtime-calls.md`，确认源码内调用方式后再生成脚本。

如果脚本用途是 Webhook，补读 `references/event-framework.md`，按其中的 `input.request` / `input.webhook` 输入约定和 HTTP 响应输出约定来写。

如果脚本是 Python，且需要额外第三方依赖，必须同时产出 `pythonRequirements`。该字段的内容等价于 `requirements.txt` 文本，并在执行前由平台安装到隔离缓存环境中。

---

## 阶段一：需求分析与脚本生成

当用户只给了业务需求、还没有脚本内容时，先完成此阶段，产出以下 5 项内容：

1. 脚本 ID
2. 脚本名称
3. Groovy 或 Python 源码
4. `inputSchema`
5. `outputSchema`

如果是带第三方依赖的 Python 脚本，再额外产出第 6 项：

6. `pythonRequirements`（即 `requirements.txt` 文本）

### ActionDock 脚本规范

ActionDock 支持 Groovy 和 Python 两种脚本类型。脚本通过 `input` 对象访问输入参数，返回值作为 `output`。

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

```python
# input 是 dict，通常使用 input.get("fieldName") 读取字段
name = input.get("name")
age = input.get("age")

# 脚本逻辑...

# 返回值必须是 JSON 可序列化结果，通常返回 dict
return {
    "field1": value1,
    "field2": value2
}
```

### 语言选择建议

- 需要 Groovy/Java 生态、`hutool`、Groovy 语法糖时，优先选 Groovy
- 需求更接近 Python 字典处理、字符串处理，或用户明确要求 Python 时，选 Python
- 如果用户没有指定语言，默认仍可优先生成 Groovy；如果需求明显更适合 Python，再改为 Python

### Webhook 脚本额外约定

当脚本用于 Webhook 时，默认输入为：

- `input.request`
  - `method`
  - `path`
  - `headers`
  - `query`
  - `rawBody`
  - `contentType`
- `input.webhook`
  - `id`
  - `key`
  - `name`

输出必须直接返回：

- `status`
- `headers`
- `body`

Python 最小模板：

```python
request = input.get("request", {})
webhook = input.get("webhook", {})

return {
    "status": 200,
    "headers": {
        "Content-Type": ["application/json;charset=UTF-8"]
    },
    "body": {
        "ok": True,
        "webhookId": webhook.get("id"),
        "rawBody": request.get("rawBody")
    }
}
```

Groovy 最小模板：

```groovy
def request = input.request instanceof Map ? input.request : [:]
def webhook = input.webhook instanceof Map ? input.webhook : [:]

return [
  status : 200,
  headers: [
    "Content-Type": ["application/json;charset=UTF-8"]
  ],
  body   : [
    ok       : true,
    webhookId: webhook.id,
    rawBody  : request.rawBody
  ]
]
```

### 可用依赖

Groovy 脚本运行环境中已预装以下依赖，可直接在脚本中使用：

| 依赖 | 版本 | 说明 |
|------|------|------|
| `groovy-all` | 4.x | Groovy 核心库，支持所有 Groovy 语法和标准库（JSON、XML、日期处理等） |
| `hutool-all` | 5.x | Hutool 工具库，提供丰富的 Java 工具方法（字符串、日期、HTTP、加解密、IO 等） |

#### Groovy 声明第三方依赖（`@Grab`）

除了预装依赖外，Groovy 脚本可通过 `@Grab` 注解声明额外的第三方依赖包。`@Grab` 是 Groovy 内置的 Grape 依赖管理机制，脚本编译时自动从 Maven 仓库解析并下载声明的 JAR。

语法：`@Grab('group:artifact:version')`，放在脚本顶部、import 语句之前：

```groovy
@Grab('org.apache.ivy:ivy:2.5.2')
import org.apache.ivy.util.StringUtils

def joined = StringUtils.join(input.parts as Object[], '-')
return [result: joined]
```

注意事项：

- `@Grab` 必须在使用该依赖的 `import` 语句之前声明
- 格式为 Maven 坐标：`groupId:artifactId:version`
- 首次执行时需要下载依赖，后续会缓存编译结果（基于源码 SHA-256），不会重复下载
- 仅支持 Maven Central 仓库中的依赖

Python 脚本默认只有宿主 `python3` 与标准库；如需第三方包，不要假设环境已预装，必须显式提供 `pythonRequirements`。如需调用平台能力，优先使用内置的 `plugins`、`scripts`、`state` 门面。

#### Python 依赖声明规范

`pythonRequirements` 使用 `requirements.txt` 文本格式，当前按以下约束生成：

- 允许普通 PyPI 包行，如 `requests==2.32.3`
- 允许单个 `--index-url ...`
- 允许注释和空行
- 不要生成 `-r`
- 不要生成 `--extra-index-url`
- 不要生成本地路径、wheel 文件路径、URL 依赖、VCS 依赖
- 不要生成 `git+...`、`https://...`、`package @ url` 这类形式

示例：

```text
requests==2.32.3
pydantic>=2.7,<3
```

### Schema 字段类型

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

### 需求分析流程

1. **理解需求**：分析用户描述的业务逻辑，明确输入参数和输出结果
2. **反问确认**：如果需求不明确，主动询问：
    - 输入参数有哪些？（名称、类型、是否必填）
    - 输出字段有哪些？
    - 是否有特殊逻辑需要处理？
3. **生成代码**：按照规范生成脚本和 Schema

### 生成原则

- 脚本代码简洁清晰，添加必要的注释
- Schema 中的 `title` 字段用于前端显示标签
- 必填字段放在 `required` 数组中
- Groovy 返回值使用 Map 字面量 `[:]` 语法
- Python 返回值使用 JSON 可序列化的 `dict` / `list` / 标量
- Groovy 可合理使用语法糖（如闭包、with 等）；Python 优先保持直接、清晰
- Python 如果依赖第三方包，依赖清单要尽量最小，只列当前脚本真实需要的包

### 脚本产物输出格式

按顺序输出以下 5 段固定格式，要求：
- 标题、文案必须保持完全一致，便于前端自动解析
- `脚本 ID` 与 `脚本名称` 段落正文使用纯文本，不要放进代码块
- 脚本源码段标题只能是 `Groovy 脚本` 或 `Python 脚本`
- `Input Schema（输入参数）`、`Output Schema（输出结果）` 必须各自只包含一个 `json` 代码块
- 不要在这 5 段中间插入额外标题，仅保留示例中的5个标题
- 这 5 段都是必需的，不能省略
- 如果是带第三方依赖的 Python 脚本，在 `#### Python 脚本` 之后、`#### Input Schema（输入参数）` 之前，额外插入 `#### Python Requirements` 段，并放一个 `text` 代码块

如果生成 Groovy，用下面格式：

#### 脚本 ID

hello-groovy

#### 脚本名称

Hello Groovy

#### Groovy 脚本

```groovy
// 脚本代码
```

如果生成 Python，把对应标题改成 `#### Python 脚本`，并使用：

```python
# 脚本代码
```

如果 Python 需要第三方依赖，再补：

#### Python Requirements

```text
requests==2.32.3
```

#### Input Schema（输入参数）

```json
{
  "type": "object",
  "properties": {
    // 字段定义
  },
  "required": ["必需字段"]
}
```

#### Output Schema（输出结果）

```json
{
  "type": "object",
  "properties": {
    // 字段定义
  }
}
```

---

## 阶段二：CLI 闭环

完成阶段一后，将生成的脚本和 Schema 写入文件，然后用 CLI 跑完整链路。

### 关键原则

- 默认使用 `--json`，让输出稳定可机读。
- 调试草稿时，默认使用 `actiondock script run <id> --draft --response-view debug --json`。
- 调试更新时，默认使用 `actiondock script patch`，不要用整对象覆盖思路。
- 当前 patch 只允许更新：
  - `source`
  - `pythonRequirements`
  - `inputSchema`
  - `outputSchema`
- 执行失败后，先读失败结果，再改草稿；不要盲改。
- 发布是显式动作；只有确认草稿可用后才执行 `script publish`。

### 标准闭环

#### 1. 创建草稿

优先使用文件输入，避免 shell 转义问题。

```bash
actiondock script create \
  --script-id hello-world \
  --name "Hello World" \
  --type groovy \
  --source-file ./hello-world.groovy \
  --input-schema-file ./input.schema.json \
  --output-schema-file ./output.schema.json \
  --json
```

如果当前脚本是 Python，把 `--type groovy`、`./hello-world.groovy` 替换为 `--type python`、`./hello-world.py`。

如果 Python 还需要第三方依赖，再追加：

```bash
  --python-requirements-file ./requirements.txt \
```

如果源码或 schema 很短，也可以内联，但文件方式更稳定。

#### 2. 校验草稿

```bash
actiondock script validate hello-world --json
```

如果这里失败，先修源码或 schema，再继续执行。

#### 3. 执行草稿

```bash
actiondock script run hello-world \
  --draft \
  --input-json '{"name":"alice"}' \
  --response-view debug \
  --json
```

关注这些字段：

- `status`
- `errorMessage`
- `errorDetail`
- `logs`
- `debug.input`
- `debug.rawOutput`

如果返回里已经有足够信息，直接修；如果只拿到了执行 ID，继续查详情。

#### 4. 读取执行详情

```bash
actiondock execution get <execution-id> --json
```

优先从这些信息判断问题：

- 输入是否符合 `inputSchema`
- `logs` 是否暴露了关键分支
- `errorMessage` / `errorDetail.stackTrace`
- `errorDetail.details.code` 是否给出了结构化失败码
- 输出结构是否和 `outputSchema` 匹配

如果是 Python 且涉及依赖安装，额外关注这些错误码：

- `PYTHON_RUNTIME_MISSING`
- `PYTHON_ENV_PREPARE_FAILED`
- `PYTHON_DEP_INSTALL_FAILED`
- `PYTHON_EXECUTION_FAILED`

#### 5. Patch 草稿

只改源码：

```bash
actiondock script patch hello-world \
  --source-file ./hello-world.v2.groovy \
  --json
```

只改 schema：

```bash
actiondock script patch hello-world \
  --input-schema-file ./input.schema.json \
  --json
```

只改 Python 依赖：

```bash
actiondock script patch hello-world \
  --python-requirements-file ./requirements.txt \
  --json
```

直接传 merge patch：

```bash
actiondock script patch hello-world \
  --patch-json '{"inputSchema":{"properties":{"enabled":{"type":"boolean"}}}}' \
  --json
```

如果同时改源码和 schema，可以在一个命令里组合：

```bash
actiondock script patch hello-world \
  --source-file ./hello-world.v3.groovy \
  --output-schema-file ./output.schema.json \
  --json
```

如果同时改 Python 源码和依赖，也可以组合：

```bash
actiondock script patch hello-world \
  --source-file ./hello-world.v2.py \
  --python-requirements-file ./requirements.txt \
  --json
```

#### 6. 循环直到成功

重复以下步骤：

1. `script patch`
2. `script validate`
3. `script run --draft --response-view debug --json`
4. 必要时 `execution get`

直到：

- 执行 `status` 为成功
- 输出字段与 `outputSchema` 一致
- 日志和 debug 信息显示逻辑正确

#### 7. 发布

```bash
actiondock script publish hello-world --json
```

发布后如果需要确认已发布版本，可读取：

```bash
actiondock script get hello-world --json
```

### 失败处理策略

#### 输入校验失败

症状：

- 命令直接返回 `400`
- 错误体里有字段级校验信息

动作：

- 先修运行输入
- 或修 `inputSchema`
- 不要先改业务逻辑源码

#### 运行时异常

症状：

- `status=FAILED`
- 有 `errorMessage`
- `errorDetail.stackTrace` 非空

动作：

- 优先修源码
- 如果是返回结构不匹配，再同步修 `outputSchema`

#### Python 依赖/环境异常

症状：

- `status=FAILED`
- `errorDetail.details.code` 为 `PYTHON_RUNTIME_MISSING` / `PYTHON_ENV_PREPARE_FAILED` / `PYTHON_DEP_INSTALL_FAILED`

动作：

- `PYTHON_RUNTIME_MISSING` / `PYTHON_ENV_PREPARE_FAILED`：优先判断运行环境是否缺少 `python3 -m venv` 能力，不要先改业务源码
- `PYTHON_DEP_INSTALL_FAILED`：优先修 `pythonRequirements`
- 只有确认依赖已安装但逻辑仍失败时，再改 Python 源码

#### 输出结构不符合预期

症状：

- 业务逻辑看似成功，但输出字段缺失、类型错误或命名不一致

动作：

- 比对 `debug.rawOutput` 与 `outputSchema`
- 明确是"代码返回错了"还是"schema 定义错了"
- 只 patch 必需字段，避免同时引入无关改动

### 推荐工作方式

- 对较长源码，先在工作区生成 `.groovy` / `.py` 文件，再用 `--source-file`。
- 对 schema，先写成 `.json` 文件，再用 `--input-schema-file` / `--output-schema-file`。
- 对 Python 第三方依赖，先写 `requirements.txt`，再用 `--python-requirements-file`。
- 每轮 patch 尽量只改一个问题，减少调试噪音。
- 如果执行结果不清楚，优先加日志再跑一轮，而不是猜。

### 不要这样做

- 不要默认走非 `--json` 输出。
- 不要把 `script patch` 当成任意字段 patch；只允许源码、`pythonRequirements` 和 schema。
- 不要在未验证草稿前直接发布。
- 不要在一次 patch 里混入大量无关重构，除非当前问题必须一起改。

### 最小模板

如果用户明确要"用 CLI 从零做一个脚本"，默认按这个顺序执行：

```bash
actiondock script create --script-id <id> --name "<name>" --type groovy --source-file ./source.groovy --input-schema-file ./input.schema.json --output-schema-file ./output.schema.json --json
actiondock script validate <id> --json
actiondock script run <id> --draft --input-json '<input-json>' --response-view debug --json
actiondock execution get <execution-id> --json
actiondock script patch <id> --source-file ./source.v2.groovy --json
actiondock script validate <id> --json
actiondock script run <id> --draft --input-json '<input-json>' --response-view debug --json
actiondock script publish <id> --json
```

如果是 Python 脚本，把上面的 `--type groovy` 和 `.groovy` 文件名替换为 `python` / `.py` 即可，其余闭环不变。

如果 Python 脚本需要第三方依赖，则在 `script create` / `script patch` 中追加 `--python-requirements-file ./requirements.txt`。

在真正执行前，先根据用户需求把 `<id>`、源码文件、schema 文件和测试输入准备好。
