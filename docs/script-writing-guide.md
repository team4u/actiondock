# 脚本编写指南

## 一句话理解

这是一个详细参考文档，涵盖脚本的完整写法：从哪里开始、怎么定义输入输出、怎么调用其他脚本/插件/AI、怎么读写共享状态和配置、怎么处理错误和日志。

## 脚本基本结构

### Groovy 脚本模板

```groovy
// input 是 Map<String, Object>，包含调用方传入的参数
// 参数结构匹配 inputSchema 定义

def name = input.name ?: "world"

// 运行时 API 在此可用：
// scripts.invoke(), plugins.invoke(), state.get/put/cas(),
// shell.exec(), shell.join(), shell.quote(),
// config.get(), log.info/warn/error(), context.executionId

// 返回 Map 作为输出，匹配 outputSchema
return [
    greeting: "Hello, ${name}!",
    timestamp: System.currentTimeMillis()
]
```

### Python 脚本模板

```python
# input 是 dict，包含调用方传入的参数
import time

name = input.get("name", "world")

# 运行时 API 在此可用：
# scripts.invoke(), plugins.invoke(), state.get/put(),
# shell.exec(), shell.join(), shell.quote(),
# config.get(), log.info/warn/error(), context["executionId"]

# 返回 dict 作为输出
return {
    "greeting": f"Hello, {name}!",
    "timestamp": int(time.time() * 1000)
}
```

### 语言选择建议

| 场景 | 推荐语言 | 原因 |
|------|----------|------|
| 快速脚本、Java 生态集成、简单逻辑 | Groovy | 与 Java/JVM 无缝集成，语法简洁 |
| 数据处理、ML 推理、文本分析 | Python | 丰富的科学计算库（pandas、numpy、scikit-learn） |
| 调用第三方 HTTP API | 都可 | Groovy 可用 `http-builder-ng`，Python 可用 `requests` |
| 文件操作 | 都可 | 两者都有完善的文件 API |

## 输入输出 Schema

### Schema 格式

使用 JSON Schema（Draft-07）格式定义。

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
      "minimum": 0,
      "maximum": 150
    },
    "email": {
      "type": "string",
      "format": "email",
      "description": "电子邮箱"
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "标签列表"
    },
    "metadata": {
      "type": "object",
      "properties": {
        "source": { "type": "string" },
        "version": { "type": "integer" }
      },
      "description": "元数据"
    }
  },
  "required": ["name"]
}
```

### Schema 支持的类型

| JSON Schema 类型 | Java 映射 | CLI flag 展平 |
|-----------------|-----------|---------------|
| `string` | String | `--name alice` |
| `integer` | Integer / Long | `--age 30` |
| `number` | Double / BigDecimal | `--price 19.99` |
| `boolean` | Boolean | `--enabled` |
| `array` | List | 不支持展平，使用 `--input-json` |
| `object` | Map | 不支持展平，使用 `--input-json` |

### Schema 的作用范围

| 位置 | 效果 |
|------|------|
| CLI | 展平为 `--name alice` 形式的 flag |
| 管理台 UI | 自动生成参数输入表单 |
| AI Agent | 自动转换为 tool description 供 LLM 理解 |
| 执行校验 | 执行前自动校验入参结构 |
| 插件调用的 Action | 作为工具定义的输入契约 |

## 依赖声明

### 脚本依赖

在编辑器的「依赖声明」区域添加对其他脚本的引用，然后在代码中调用：

```groovy
// Groovy - 调用其他已发布脚本
def result = scripts.invoke("data-transform", [raw: input.data])

// 调用时可以获取返回值
def summary = scripts.invoke("summarize-text", [text: longText])
log.info("摘要结果: {}", summary)
```

```python
# Python - 调用其他已发布脚本
result = scripts.invoke("data-transform", {"raw": input["data"]})
```

**跨语言调用**：Groovy 脚本可以调用 Python 脚本，Python 脚本也可以调用 Groovy 脚本。平台自动路由到对应的脚本引擎。

### 插件依赖

声明所需插件 ID 和 Action，运行时调用：

```groovy
// Groovy
def result = plugins.invoke("actiondock-ai", "chat", [
    modelProfileId: "my-model",
    messages: [[role: "user", content: "Hello"]]
])
```

```python
# Python
result = plugins.invoke("actiondock-ai", "chat", {
    "modelProfileId": "my-model",
    "messages": [{"role": "user", "content": "Hello"}]
})
```

### AI 依赖

声明所需 AI 能力类型：`CHAT`、`STRUCTURED_OUTPUT`、`EMBEDDING`。

用于让平台了解脚本需要哪些 AI 资源。

## 运行时 API 完整参考

### scripts.invoke() — 调用其他脚本

```groovy
// 基本调用
def result = scripts.invoke("target-script-id", [param1: "value1"])

// result 是 Map<String, Object>，包含目标脚本的输出
def greeting = result.greeting
```

| 参数 | 类型 | 说明 |
|------|------|------|
| 第一个参数 | String | 目标脚本 ID（必须已发布） |
| 第二个参数 | Map | 输入参数，匹配目标脚本的 `inputSchema` |

### plugins.invoke() — 调用插件 Action

```groovy
// 基本调用
def result = plugins.invoke("plugin-id", "action-id", [param1: "value1"])

// 选择命名插件配置
def prodResult = plugins.invoke("plugin-id", "action-id", [param1: "value1"], [configName: "prod"])

// 调用 actiondock-ai 插件
def chatResult = plugins.invoke("actiondock-ai", "chat", [
    modelProfileId: "my-model",
    messages: [
        [role: "system", content: "你是一个翻译助手"],
        [role: "user", content: "翻译：Hello"]
    ]
])

// 结构化输出
def structuredResult = plugins.invoke("actiondock-ai", "structured", [
    modelProfileId: "my-model",
    messages: [[role: "user", content: "提取信息"]],
    responseSchema: [
        type: "object",
        properties: [
            name: [type: "string"],
            value: [type: "number"]
        ]
    ]
])

// 向量嵌入
def embedResult = plugins.invoke("actiondock-ai", "embed", [
    modelProfileId: "my-embedding-model",
    input: ["要编码的文本"]
])

// 运行 Agent
def agentResult = plugins.invoke("actiondock-ai", "agentRun", [
    agentProfileId: "my-agent",
    input: "帮我查一下订单"
])
```

| 参数 | 类型 | 说明 |
|------|------|------|
| 第一个参数 | String | 插件 ID |
| 第二个参数 | String | Action ID |
| 第三个参数 | Map | 输入参数，匹配 Action 的 `inputSchema` |

### state.get/put/cas/list() — 共享状态

```groovy
// 读取共享状态
def value = state.get("my-namespace", "my-key")

// 写入共享状态（覆盖）
state.put("my-namespace", "my-key", [count: 42])

// CAS 乐观锁更新（期望当前 version = 3）
state.cas("my-namespace", "my-key", [count: 43], 3)

// 列出命名空间下的所有条目
def entries = state.list("my-namespace")
// entries 是 List<Map<String, Object>>，每项包含 key, value, version, secret 等

// 删除条目
state.delete("my-namespace", "my-key")
```

```python
# Python
value = state.get("my-namespace", "my-key")
state.put("my-namespace", "my-key", {"count": 42})
entries = state.list("my-namespace")
```

### config.get() — 读取配置值

```groovy
// 读取全局配置值
def apiKey = config.get("ai.openai.key")
def dbUrl = config.get("database.url")

// 如果配置值不存在，返回 null
```

```python
# Python
api_key = config.get("ai.openai.key")
```

### log.info/warn/error() — 输出日志

```groovy
log.info("开始处理，参数: {}", input)
log.warn("速率接近限制，当前: {}/{}", current, max)
log.error("处理失败: {}", errorMessage)

// 支持 {} 占位符，类似 SLF4J
```

```python
log.info("开始处理，参数: %s", input)
log.warn("速率接近限制")
log.error("处理失败: %s", error_message)
```

日志会在执行记录的 `logs` 字段中展示，可通过执行详情查看。

### shell.exec/quote/join() — 执行本机命令

脚本可以通过 `shell` 门面执行运行主机上的命令，并读取标准输出、标准错误和退出码。

```groovy
def command = shell.join(["echo", input.message])
def result = shell.exec(command, [
    timeoutSeconds: 30,
    check: false
])

if (!result.ok) {
    throw new IllegalStateException("命令执行失败: ${result.stderr}")
}

return [
    exitCode: result.exitCode,
    stdout: result.stdout
]
```

```python
command = shell.join(["echo", input.get("message")])
result = shell.exec(command, {
    "timeoutSeconds": 30,
    "check": False
})

if not result.get("ok"):
    raise RuntimeError("命令执行失败: " + result.get("stderr", ""))

return {
    "exitCode": result.get("exitCode"),
    "stdout": result.get("stdout")
}
```

`shell.exec(command, options)` 常用参数：

| 参数 | 说明 |
|------|------|
| `cwd` | 命令工作目录。相对路径基于服务进程当前工作目录解析；不传时继承服务进程当前工作目录。目录必须已存在，框架不会自动创建 |
| `env` | 追加环境变量，key/value 会转成字符串 |
| `timeoutSeconds` | 超时时间，默认 30 秒 |
| `check` | 默认 `true`。命令失败、超时或启动失败时直接抛异常；设为 `false` 时返回失败结果 |
| `shell` | `auto` / `bash` / `sh` / `powershell` / `cmd`，默认 `auto` |
| `maxOutputBytes` | stdout 和 stderr 各自最多捕获的字节数，默认 1048576 |

返回结果字段：

| 字段 | 说明 |
|------|------|
| `ok` | 命令完成且退出码为 0 |
| `exitCode` | 进程退出码；超时或启动失败时为 -1 |
| `stdout` / `stderr` | 标准输出和标准错误 |
| `timedOut` | 是否超时 |
| `durationMs` | 执行耗时 |
| `stdoutTruncated` / `stderrTruncated` | 输出是否因 `maxOutputBytes` 被截断 |

拼接命令时优先使用：

- `shell.join(args)`：把参数数组拼成安全命令字符串
- `shell.quote(value)`：只转义单个参数

不要直接把用户输入拼进命令字符串；完整命令优先用 `shell.join`。不要手写 `arg.contains(" ") ? "\"${arg}\"" : arg` 这类 Windows 分支，`shell.join` 会按当前 shell 处理命令位和参数转义。

```groovy
def command = shell.join([
    "agent-browser",
    "--session", session,
    "open", input.url
])
def result = shell.exec(command, [check: false])
```

如果脚本需要写入截图、下载文件、日志片段等产物，可以使用 `context.artifactDir` 作为约定路径，但框架不会自动创建或清理该目录。脚本需要自行创建目录，并在不需要保留产物时自行回收。

### context — 执行上下文

脚本可以通过 `context` 读取当前执行的运行时信息。

Groovy：

```groovy
return [
    executionId: context.executionId,
    artifactDir: context.artifactDir
]
```

Python：

```python
return {
    "executionId": context.get("executionId"),
    "artifactDir": context.get("artifactDir")
}
```

| 字段 | 说明 |
|------|------|
| `executionId` | 当前执行记录 ID |
| `submitMode` | `SYNC` 或 `ASYNC` |
| `artifactDir` | 本次执行的产物目录约定路径，默认位于 `${app.home-dir}/runs/<executionId>`；只返回路径字符串，不自动创建目录 |

### file.read/write() — 文件系统访问

```groovy
// 读取文件
def content = file.read("/path/to/file.txt")

// 写入文件
file.write("/path/to/output.txt", "文件内容")
```

```python
# Python
content = file.read("/path/to/file.txt")
file.write("/path/to/output.txt", "文件内容")
```

**注意：** 文件操作权限受运行时安全策略限制。

### throw / try-catch — 错误处理

```groovy
// 脚本执行中发生未捕获异常时：
// 1. 执行记录状态变为 FAILED
// 2. errorMessage 记录异常信息
// 3. errorDetail 包含堆栈详情
// 脚本的最后返回值不会被使用

// 自定义错误场景
def validate(input) {
    if (!input.name) {
        throw new IllegalArgumentException("name 不能为空")
    }
    if (input.age < 0) {
        throw new IllegalArgumentException("age 不能为负数")
    }
}

// try-catch 捕获错误
try {
    def result = scripts.invoke("other-script", [data: input.raw])
} catch (Exception e) {
    log.error("调用其他脚本失败: {}", e.message)
    return [status: "ERROR", message: e.message]
}
```

```python
def validate(input):
    if not input.get("name"):
        raise ValueError("name 不能为空")

try:
    result = scripts.invoke("other-script", {"data": input["raw"]})
except Exception as e:
    log.error("调用其他脚本失败: %s", str(e))
    return {"status": "ERROR", "message": str(e)}
```

## Python 脚本专属

### 第三方依赖

在脚本编辑器的 `pythonRequirements` 字段中声明依赖，格式同 `requirements.txt`：

```
requests==2.31.0
pandas>=2.0
numpy<2.0
openai==1.12.0
```

平台会将依赖安装到隔离的虚拟环境中，不影响宿主环境的 Python 包。

### 可用标准库

所有 Python 标准库模块均可直接使用：`json`、`csv`、`re`、`datetime`、`math`、`random`、`collections`、`itertools` 等。

## 完整示例：发送 HTTP 请求的脚本

### Groovy 版本

```groovy
// inputSchema:
// {
//   "url": {"type": "string"},
//   "payload": {"type": "object"}
// }

import groovy.json.JsonOutput
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

def client = HttpClient.newHttpClient()
def requestBody = JsonOutput.toJson(input.payload)

def request = HttpRequest.newBuilder()
    .uri(URI.create(input.url))
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(requestBody))
    .build()

def response = client.send(request, HttpResponse.BodyHandlers.ofString())

return [
    statusCode: response.statusCode(),
    body: response.body(),
    success: response.statusCode() == 200
]
```

### Python 版本

```python
# inputSchema:
# {
#   "url": {"type": "string"},
#   "payload": {"type": "object"}
# }

import requests

response = requests.post(
    input["url"],
    json=input.get("payload", {}),
    headers={"Content-Type": "application/json"},
    timeout=30
)

return {
    "statusCode": response.status_code,
    "body": response.text,
    "success": response.status_code == 200
}
```

## 最佳实践

- **明确返回值**：始终返回一个 Map/Dict，即使没有有意义的数据也返回 `[success: true]` 或 `{"success": true}`
- **日志要合理**：关键步骤加 `log.info`，异常情况加 `log.error`，便于排查执行记录
- **参数校验前置**：在脚本开头校验 input 参数，不满足条件时提前返回错误
- **单个脚本职责单一**：一个脚本做一件事，通过 `scripts.invoke()` 组合成复杂流程
- **大脚本拆解**：超过 100 行的 Groovy 或 Python 脚本，考虑拆分为多个小脚本
- **共享状态用于协调**：跨脚本的数据协调用共享状态，不依赖外部文件或服务
- **计算和 IO 分离**：纯计算逻辑在脚本中完成，IO 操作（HTTP、数据库）复用插件

---

> [返回目录](user-manual.md) | 下一步：查看 [CLI 参考](cli-reference.md)
