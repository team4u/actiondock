# 脚本源码内调用插件和脚本

当用户要写 ActionDock 脚本，并且脚本内部需要调用插件或另一个已发布脚本时，读取本文件。

本文件只覆盖脚本源码内的运行时门面：

- `plugins.invoke(...)`
- `scripts.invoke(...)`

CLI 执行命令见 `references/script-execution.md`，CLI 插件调用见 `references/plugin-usage.md`。

---

## 1. 可用门面

### 插件调用

Groovy：

```groovy
def result = plugins.invoke("my-plugin", "actionName", [key: "value"])
return result
```

Python：

```python
result = plugins.invoke("my-plugin", "actionName", {"key": "value"})
return result
```

使用场景：

- 调系统插件，如 `actiondock-ai`
- 调业务插件，如通知、HTTP 封装、第三方系统桥接

### 调用另一个已发布脚本

Groovy：

```groovy
def result = scripts.invoke("target-script-id", [name: input.name])
return result
```

Python：

```python
result = scripts.invoke("target-script-id", {"name": input.get("name")})
return result
```

注意：

- `scripts.invoke(...)` 调用的是**已发布脚本**
- 目标脚本的入参与返回值要和其已发布 schema 对齐

---

## 2. 如何确定可调用对象

### 确认插件 ID 和 action

先用 CLI：

```bash
actiondock plugin references --json
actiondock plugin get <plugin-id> --json
```

再把确认后的 `pluginId` 和 `action` 写进 `plugins.invoke(...)`。

### 确认目标脚本 ID 和入参

先用 CLI：

```bash
actiondock script list
actiondock script schema <script-id>
```

再把目标脚本 ID 和需要的入参写进 `scripts.invoke(...)`。

---

## 3. 常见示例

### 在脚本里调用 AI 插件

Groovy：

```groovy
def result = plugins.invoke("actiondock-ai", "chat", [
  modelProfile: "default-chat",
  messages: [
    [role: "system", content: "你是一个脚本助手"],
    [role: "user", content: input.text]
  ]
])

return [summary: result.text]
```

Python：

```python
result = plugins.invoke("actiondock-ai", "chat", {
  "modelProfile": "default-chat",
  "messages": [
    {"role": "system", "content": "你是一个脚本助手"},
    {"role": "user", "content": input.get("text")}
  ]
})

return {"summary": result["text"]}
```

约定：

- `chat` / `structured` / `embed` 使用 `modelProfile`
- `agentRun` 使用 `agentProfile`

### 在脚本里调用另一个脚本

Groovy：

```groovy
def normalized = scripts.invoke("normalize-user", [name: input.name])
return [user: normalized]
```

Python：

```python
normalized = scripts.invoke("normalize-user", {"name": input.get("name")})
return {"user": normalized}
```

### 先调插件，再调脚本

Groovy：

```groovy
def summary = plugins.invoke("actiondock-ai", "chat", [
  modelProfile: "default-chat",
  messages: [[role: "user", content: input.text]]
])

return scripts.invoke("save-summary", [text: summary.text, source: input.text])
```

Python：

```python
summary = plugins.invoke("actiondock-ai", "chat", {
  "modelProfile": "default-chat",
  "messages": [{"role": "user", "content": input.get("text")}]
})

return scripts.invoke("save-summary", {
  "text": summary["text"],
  "source": input.get("text")
})
```

---

## 4. 失败处理建议

### 插件调用失败

优先检查：

1. `pluginId` 是否存在
2. `action` 是否存在
3. `args` 是否符合 action 的 `inputSchema`
4. 插件是否依赖额外配置

### 脚本互调失败

优先检查：

1. 目标脚本是否已发布
2. 目标脚本 ID 是否写错
3. 传入参数是否符合目标脚本 `inputSchema`
4. 当前脚本是否错误假设了返回结构

### 推荐做法

- 用字面量固定 `pluginId` / `action` / `scriptId`，不要默认写动态值
- 在联调前，先用 CLI 单独验证插件动作或目标脚本是否可用
- 如果链路复杂，先分别跑通每一步，再组合成一个脚本
