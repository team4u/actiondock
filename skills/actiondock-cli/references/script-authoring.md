# 脚本作者态闭环

从业务需求出发，完成脚本生成、创建草稿、校验、调试、Patch、循环修复和发布。先遵守 `references/common.md`。

需要脚本内调用插件/脚本/本机命令时补读 `script-runtime-calls.md`；Webhook 脚本补读 `webhook.md`。

## 产物

当用户只给业务需求时，先产出：

1. 脚本 ID
2. 脚本名称
3. Groovy 或 Python 源码
4. `inputSchema`
5. `outputSchema`
6. Python 第三方依赖脚本额外产出 `pythonRequirements`

输出格式固定为：

````markdown
#### 脚本 ID
hello-world

#### 脚本名称
Hello World

#### Groovy 脚本
```groovy
// code
```

#### Input Schema（输入参数）
```json
{"type":"object","properties":{}}
```

#### Output Schema（输出结果）
```json
{"type":"object","properties":{}}
```
````

Python 源码段标题改为 `#### Python 脚本`；如有第三方依赖，在源码后、Input Schema 前插入：

````markdown
#### Python Requirements
```text
requests==2.32.3
```
````

## 脚本规范

ActionDock 支持 Groovy 和 Python。脚本通过 `input` 访问输入参数，返回值作为 `output`。

| 对象 | 作用 |
|------|------|
| `input` | 本次调用参数 |
| `config` | 读取配置快照 |
| `log` | 写入执行日志 |
| `scripts` | 调用其他已发布脚本 |
| `plugins` | 调用插件 Action |
| `state` | 读写共享状态 |
| `shell` | 执行本机命令 |
| `context` | 读取 `executionId`、`submitMode`、`artifactDir` |

Groovy 返回 Map：

```groovy
def name = input.name
return [ok: true, name: name]
```

Python 返回 JSON 可序列化对象：

```python
name = input.get("name")
return {"ok": True, "name": name}
```

语言选择：

- 用户指定语言时遵从用户。
- 需要 Groovy/Java 生态、`hutool`、Groovy 语法糖时选 Groovy。
- 更适合字典、字符串处理或 Python 生态时选 Python。
- 用户未指定且无明显倾向时默认 Groovy。

Schema 使用 JSON Schema 基本类型：`string`、`number`、`integer`、`boolean`、`array`、`object`；枚举用 `{"type":"string","enum":[...]}`。`title` 用于前端显示，必填字段放在 `required`。

字符串字段可选 UI 扩展：

```json
{
  "description": {
    "type": "string",
    "title": "描述",
    "x-ui": {"widget": "textarea", "rows": 4}
  }
}
```

## 依赖与本机命令

Groovy 已预装：

| 依赖 | 版本 | 说明 |
|------|------|------|
| `groovy-all` | 4.x | Groovy 核心库 |
| `hutool-all` | 5.x | Java 工具库 |

额外 Groovy 依赖可在 import 前用 `@Grab('group:artifact:version')`，仅支持 Maven Central。

Python 默认只有宿主 `python3` 与标准库。第三方依赖必须显式提供 `pythonRequirements`，格式等价 `requirements.txt`：

- 允许普通 PyPI 包行、单个 `--index-url`、注释和空行。
- 不要生成 `-r`、`--extra-index-url`、本地路径、wheel 路径、URL/VCS 依赖、`package @ url`。

脚本执行本机命令时，优先使用 `shell.join([...])`、`shell.quote(value)`、`shell.exec(command, options)`；不要直接拼接用户输入。`shell.exec` 默认 `check: true`。`context.artifactDir` 只是路径字符串，脚本按需自行创建和清理目录。

## CLI 闭环

关键原则：

- 创建和 patch 优先使用文件输入，避免 shell 转义问题。
- 调试草稿默认用 `--draft --response-view debug --json --output-file ... --overwrite-output`。
- `script patch` 只用于 `source`、`pythonRequirements`、`inputSchema`、`outputSchema`。
- 执行失败后先读失败结果，再改草稿。
- 发布是显式动作；草稿验证通过后才 `script publish`。

标准闭环：

```bash
actiondock script create \
  --script-id hello-world \
  --name "Hello World" \
  --type groovy \
  --source-file ./hello-world.groovy \
  --input-schema-file ./input.schema.json \
  --output-schema-file ./output.schema.json \
  --json

actiondock script validate hello-world --json

actiondock script run hello-world \
  --draft \
  --input-file ./input.json \
  --response-view debug \
  --json \
  --output-file /tmp/actiondock-run.json \
  --overwrite-output

actiondock execution get <execution-id> \
  --json \
  --output-file /tmp/actiondock-execution.json \
  --overwrite-output

actiondock script patch hello-world --source-file ./hello-world.v2.groovy --json
actiondock script validate hello-world --json
actiondock script run hello-world --draft --input-file ./input.json --response-view debug --json --output-file /tmp/actiondock-run.json --overwrite-output
actiondock script publish hello-world --json
```

Python 脚本把 `--type groovy` 和 `.groovy` 文件替换为 `--type python` / `.py`；有依赖时在 `create` / `patch` 加：

```bash
--python-requirements-file ./requirements.txt
```

常用 patch：

```bash
actiondock script patch hello-world --source-file ./source.v2.groovy --json
actiondock script patch hello-world --input-schema-file ./input.schema.json --json
actiondock script patch hello-world --output-schema-file ./output.schema.json --json
actiondock script patch hello-world --python-requirements-file ./requirements.txt --json
actiondock script patch hello-world --patch-json '{"inputSchema":{"properties":{"enabled":{"type":"boolean"}}}}' --json
```

## 失败处理

读取 `/tmp/actiondock-run.json` 或执行详情后优先判断：

- 输入是否符合 `inputSchema`
- `logs` 是否暴露关键分支
- `errorMessage` / `errorDetail.stackTrace`
- `errorDetail.details.code`
- 输出结构是否匹配 `outputSchema`

处理策略：

| 症状 | 动作 |
|------|------|
| 输入校验失败 | 先修运行输入或 `inputSchema`，不要先改业务源码 |
| 运行时异常 | 优先修源码；返回结构不匹配时同步修 `outputSchema` |
| `PYTHON_RUNTIME_MISSING` / `PYTHON_ENV_PREPARE_FAILED` | 优先判断服务端 Python / venv 能力 |
| `PYTHON_DEP_INSTALL_FAILED` | 优先修 `pythonRequirements` |
| 输出字段缺失或类型错误 | 比对 `debug.rawOutput` 与 `outputSchema`，只 patch 必需字段 |
