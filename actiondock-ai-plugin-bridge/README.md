# actiondock-ai-plugin-bridge

把平台 AI 能力桥接成一个系统插件 `actiondock-ai`，让 Groovy 脚本通过统一的 `plugins.invoke(...)` 门面直接调用模型和 Agent。

## 暴露方式

这个模块不要求用户单独安装插件 JAR。平台启动后会把它作为内置系统插件暴露给脚本运行时。

## 主要动作

- `chat`
- `structured`
- `embed`
- `agentRun`

## Groovy 调用示例

```groovy
def result = plugins.invoke("actiondock-ai", "chat", [
  modelProfile: "default-chat",
  messages: [
    [role: "system", content: "你是一个脚本助手"],
    [role: "user", content: "请总结 input.text"]
  ]
])

return [summary: result.text]
```

```groovy
def run = plugins.invoke("actiondock-ai", "agentRun", [
  agentProfile: "workbench-script-dev-agent",
  messages: [
    [role: "user", content: "分析当前脚本并给出改进建议"]
  ],
  input: [
    goal: "review script",
    scriptId: "hello-groovy"
  ]
])

return [
  agentRunId: run.runId,
  status: run.status,
  output: run.output
]
```

## 使用约定

- `chat`、`structured`、`embed` 使用 `modelProfile`
- `agentRun` 使用 `agentProfile`
- 当前只有 `GROOVY` 运行时支持通过 `plugins.invoke(...)` 使用 AI
- `PYTHON` 运行时当前不支持插件门面

## 相关模块

- 插件 SPI 见 [../actiondock-plugin-api/README.md](../actiondock-plugin-api/README.md)
- AI 抽象见 [../actiondock-ai-api/README.md](../actiondock-ai-api/README.md)
- AI 服务实现见 [../actiondock-ai-core/README.md](../actiondock-ai-core/README.md)
