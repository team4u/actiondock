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
