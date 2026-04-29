# actiondock-app-support

运行时装配模块，把脚本平台、AI 模块、插件系统、仓库解析和配置系统真正拼接成一个可运行的应用。

## 主要职责

- 装配脚本执行引擎
- 装配 PF4J 插件运行时
- 装配仓库解析与插件制品解析
- 暴露动态 Tool Provider
- 提供统一应用配置 `AppProperties`

## 关键组件

### 脚本运行时

- `GroovyScriptEngine`
- `PythonScriptEngine`
- `RoutingScriptEngine`
- `CompiledGroovyScriptCache`
- `ScriptStateBridge`

### 插件运行时

- `PluginRuntimeService`
- `GroovyPlugins`

### 仓库与制品

- `RepositoryCatalogService`
- `PluginArtifactResolverRegistry`
- `LocalPluginArtifactResolver`
- `HttpPluginArtifactResolver`

### AI

- `org.team4u.actiondock.ai.tool`

## 默认配置关注点

- `app.home-dir`
- `app.plugins.dir`
- `app.execution.async-pool-size`
- `app.execution.groovy.*`
- `app.execution.python.*`

默认运行时目录：

- 数据库：`~/.actiondock/data`
- 插件：`~/.actiondock/plugins`
- 仓库工作目录：`~/.actiondock/repositories`

## 脚本内门面

Groovy 和 Python 脚本都会注入这些运行时对象：

- `log`
- `config`
- `plugins`
- `scripts`
- `state`

### 插件调用示例

Groovy：

```groovy
def result = plugins.invoke("actiondock-ai", "chat", [
    modelProfile: "default-chat",
    messages: [[role: "user", content: input.text]]
])

return [summary: result.text]
```

Python：

```python
result = plugins.invoke("actiondock-ai", "chat", {
    "modelProfile": "default-chat",
    "messages": [{"role": "user", "content": input.get("text")}]
})

return {"summary": result["text"]}
```

### 脚本互调示例

Groovy：

```groovy
return scripts.invoke("target-script-id", [name: input.name])
```

Python：

```python
return scripts.invoke("target-script-id", {"name": input.get("name")})
```

## 脚本内共享状态 `state`

Groovy 和 Python 脚本现在都会注入内置对象 `state`，用于访问通用共享状态存储。

支持的方法：

- `state.get(namespace, key)`
- `state.put(namespace, key, value)`
- `state.put(namespace, key, value, options)`
- `state.cas(namespace, key, expectedVersion, value)`
- `state.cas(namespace, key, expectedVersion, value, options)`
- `state.delete(namespace, key)`
- `state.list(namespace)`

`options` 当前支持：

- `secret: true | false`
- `ttlSeconds: number`

返回语义：

- `get`：返回完整条目，或 `null`
- `put`：返回完整条目
- `cas`：返回 `{ updated, entry, current }`
- `list`：返回同命名空间下的条目摘要列表，不包含 `value`

完整条目字段通常包括：

- `namespace`
- `key`
- `value`
- `secret`
- `version`
- `expiresAt`
- `createdAt`
- `updatedAt`
- `lastWriterScriptId`
- `lastWriterExecutionId`

### Groovy 示例

```groovy
def tokenState = state.get("oauth.github", "access-token")
if (tokenState && tokenState.value?.accessToken) {
    return [token: tokenState.value.accessToken, reused: true]
}

def saved = state.put(
    "oauth.github",
    "access-token",
    [accessToken: "gho_xxx", tokenType: "Bearer"],
    [secret: true, ttlSeconds: 3600]
)

return [version: saved.version, expiresAt: saved.expiresAt]
```

### Python 示例

```python
token_state = state.get("oauth.github", "access-token")
if token_state and token_state.get("value", {}).get("accessToken"):
    return {"token": token_state["value"]["accessToken"], "reused": True}

saved = state.put(
    "oauth.github",
    "access-token",
    {"accessToken": "gho_xxx", "tokenType": "Bearer"},
    {"secret": True, "ttlSeconds": 3600},
)

return {"version": saved["version"], "expiresAt": saved["expiresAt"]}
```

### CAS 示例

适合更新游标、水位线、批次号这类有并发写入风险的状态：

```groovy
def current = state.get("cursor.sync", "users")
def result = state.cas("cursor.sync", "users", current?.version, [cursor: "next-token"])

if (!result.updated) {
    throw new IllegalStateException("共享状态版本冲突，请重试")
}
```

运行时语义：

- 过期条目对脚本不可见，`state.get(...)` 会返回 `null`
- `ttlSeconds` 必须大于 `0`
- 写入时会自动记录当前脚本 ID 和执行 ID

## 脚本引擎底层交互机制

Groovy 和 Python 的脚本引擎实现完全不同，但对外暴露了统一的门面（`plugins`、`scripts`、`state`、`log`、`config`）。脚本互调不依赖语言层面直接调用，而是通过平台统一的 `scripts.invoke()` 门面实现——无论调用方和被调用方各自是什么语言，都能互通。

### Groovy：JVM 内直接执行

`GroovyScriptEngine` 在 JVM 内编译并运行脚本，通过 Groovy `Binding` 将门面对象作为本地变量注入：

```
Binding binding = new Binding();
binding.setVariable("input", input);
binding.setVariable("config", config);
binding.setVariable("log", new ScriptLogger(context));
binding.setVariable("plugins", new GroovyPlugins(...));
binding.setVariable("scripts", new GroovyScripts(...));
binding.setVariable("state", new ScriptStateBridge(...));
```

门面对象是普通 Java/Groovy 对象，方法调用发生在同一进程、同一线程内，没有 IPC 开销。

### Python：子进程 + stderr 桥接协议

`PythonScriptEngine` 以子进程方式执行 Python 脚本。用户脚本被包装进模板（`python-wrapper.py`），模板定义了 `__ActionDockPlugins`、`__ActionDockScripts`、`__ActionDockState` 等 Python 类，使得脚本源码可以用自然的 Python 语法调用门面。

底层通过 **stderr 前缀协议** 与 Java 引擎通信：

| 方向 | 通道 | 协议格式 | 用途 |
|------|------|----------|------|
| Python → Java | stderr | `__ACTIONDOCK_LOG__` + JSON | 脚本日志 |
| Python → Java | stderr | `__ACTIONDOCK_PLUGIN__` + JSON | 插件调用请求 |
| Python → Java | stderr | `__ACTIONDOCK_INVOKE__` + JSON | 脚本互调请求 |
| Python → Java | stderr | `__ACTIONDOCK_STATE__` + JSON | 共享状态请求 |
| Java → Python | stdin | JSON 行 | 请求的返回结果 |
| Java → Python | stdin（首行）| JSON 行 | 脚本输入 `input` |
| Python → Java | stdout | JSON | 脚本最终返回值 |

以 `plugins.invoke("my-plugin", "action", args)` 为例，一次完整的调用流程：

```
Python 脚本
  │
  │  plugins.invoke("my-plugin", "action", {"key": "value"})
  │
  ▼
python-wrapper.py：__ActionDockPlugins.invoke()
  │  向 stderr 写入：__ACTIONDOCK_PLUGIN__{"pluginId":"my-plugin","action":"action","args":{"key":"value"}}
  │  从 stdin 阻塞读取一行
  │
  ▼
PythonScriptEngine：handlePlugin()
  │  解析前缀 + JSON 载荷
  │  调用 PluginRuntimeService.invoke()
  │  向 stdin 写入：{"ok":true,"result":{...}}
  │
  ▼
python-wrapper.py
  │  解析 JSON 响应，返回 result 或抛出异常
  │
  ▼
Python 脚本获得返回值
```

`scripts.invoke()` 和 `state` 操作的流程与此相同，只是 stderr 前缀和载荷结构不同。

### 脚本互调模型

平台通过 `ScriptInvocationService` 实现脚本互调，不关心调用方和被调用方的语言类型：

```
Groovy 脚本 ──scripts.invoke("py-script")──→ RoutingScriptEngine ──→ PythonScriptEngine ──→ Python 子进程
Python 脚本 ──scripts.invoke("gy-script")──→ PythonBridge ──→ Java 引擎 ──→ GroovyScriptEngine ──→ JVM
Python 脚本 ──scripts.invoke("py-script")──→ PythonBridge ──→ Java 引擎 ──→ PythonScriptEngine ──→ 另一个 Python 子进程
Groovy 脚本 ──scripts.invoke("gy-script")──→ GroovyScripts ──→ Java 引擎 ──→ GroovyScriptEngine ──→ JVM
```

互调时被调用脚本始终以**已发布版本**执行（`invokePublished`），草稿修改不会影响正在被其他脚本调用的版本。

## 适合放在这里的能力

- 运行时实现与装配
- 脚本引擎和插件交互
- 仓库文件系统和网络制品解析
- AI 辅助服务

不适合放这里的是纯领域规则，那些应留在 `actiondock-core` 或 `actiondock-ai-*`。

## 相关模块

- 核心领域见 [../actiondock-core/README.md](../actiondock-core/README.md)
- Web 入口见 [../actiondock-app-spring/README.md](../actiondock-app-spring/README.md)
- AI 脚本桥接见 [../actiondock-ai-plugin-bridge/README.md](../actiondock-ai-plugin-bridge/README.md)
