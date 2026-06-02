# 脚本源码内运行时门面

当用户要写 ActionDock 脚本，并且脚本内部需要调用插件、另一个已发布脚本、共享状态或本机命令时，读取本文件。

本文件只覆盖脚本源码内的运行时门面：

- `plugins.invoke(...)`
- `scripts.invoke(...)`
- `state.get/put/cas/list/delete(...)`
- `shell.exec(...)`
- `shell.quote(...)`
- `shell.join(...)`
- `context`

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

### 执行本机命令

Groovy：

```groovy
def command = shell.join(["echo", input.message])
def result = shell.exec(command, [check: false, timeoutSeconds: 30])
return [ok: result.ok, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode]
```

Python：

```python
command = shell.join(["echo", input.get("message")])
result = shell.exec(command, {"check": False, "timeoutSeconds": 30})
return {"ok": result["ok"], "stdout": result["stdout"], "stderr": result["stderr"], "exitCode": result["exitCode"]}
```

注意：

- 拼完整命令时优先用 `shell.join([...])`，不要直接拼用户输入
- `shell.quote(value)` 只用于转义单个参数；不要手写 `arg.contains(" ") ? "\"${arg}\"" : arg` 这类 Windows 分支
- `shell.exec` 默认 `check: true`，非 0 退出码、超时或启动失败会抛异常
- 需要自己处理失败时传 `check: false`
- 不传 `cwd` 时使用服务进程当前工作目录；传入的 `cwd` 必须已存在，框架不会自动创建
- `timeoutSeconds` 和 `maxOutputBytes` 用来防止命令挂死或输出过大

推荐写法：

```groovy
def command = shell.join(["agent-browser", "--session", session, "open", input.url])
def result = shell.exec(command, [check: false])
```

### 执行上下文

Groovy：

```groovy
def runDir = context.artifactDir
return [executionId: context.executionId, runDir: runDir]
```

Python：

```python
run_dir = context.get("artifactDir")
return {"executionId": context.get("executionId"), "runDir": run_dir}
```

`context.artifactDir` 是本次执行的产物目录约定路径，只返回字符串，不代表目录已经存在。需要写入截图、下载文件、日志片段等产物时，脚本应自行创建目录；临时产物也由脚本自行删除或按业务规则保留。

---

## 2. 如何确定可调用对象

### 确认插件 ID 和 action

先用 CLI：

```bash
actiondock plugin references --json
actiondock plugin get <plugin-id> --json
actiondock plugin action <plugin-id> <action> --json
```

先用 `plugin references` 或 `plugin get` 确认插件 ID 和动作名，再用 `plugin action` 查看具体动作的参数 Schema，最后把确认后的 `pluginId`、`action` 和参数写进 `plugins.invoke(...)`。


### 确认目标脚本 ID 和入参

先用 CLI：

```bash
actiondock script list --intent "<regex>"
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
