# actiondock-app-support

运行时装配模块，把脚本平台、AI 模块、插件系统、仓库解析和配置系统真正拼接成一个可运行的应用。

## 主要职责

- 装配脚本执行引擎
- 装配 PF4J 插件运行时
- 装配仓库解析与插件制品解析
- 暴露 AI Workbench 和动态 Tool Provider
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

### AI 与工作台

- `org.team4u.actiondock.ai.tool`
- `org.team4u.actiondock.ai.workbench`

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
- Python 脚本通过 stderr/stdin 桥接协议访问状态，Groovy 脚本通过本地对象直接访问

## 适合放在这里的能力

- 运行时实现与装配
- 脚本引擎和插件交互
- 仓库文件系统和网络制品解析
- 工作台辅助服务

不适合放这里的是纯领域规则，那些应留在 `actiondock-core` 或 `actiondock-ai-*`。

## 相关模块

- 核心领域见 [../actiondock-core/README.md](../actiondock-core/README.md)
- Web 入口见 [../actiondock-app-spring/README.md](../actiondock-app-spring/README.md)
- AI 脚本桥接见 [../actiondock-ai-plugin-bridge/README.md](../actiondock-ai-plugin-bridge/README.md)
