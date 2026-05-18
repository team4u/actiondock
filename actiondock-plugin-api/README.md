# actiondock-plugin-api

ActionDock 的插件 SPI 模块，定义 PF4J 插件如何向平台声明动作、配置和运行时交互协议。

## 关键接口

- `ActionDockPlugin`：插件扩展点
- `ScriptPluginContext`：脚本调用插件时的上下文
- `PluginManifest`：插件元数据
- `PluginActionManifest`：插件动作描述
- `PluginManifestLoader`：Manifest 读取器
- `PluginConfigBinder`：插件配置绑定工具

## 插件实现最小要求

1. 实现一个 PF4J `Plugin` 入口类
2. 使用 `@Extension` 实现 `ActionDockPlugin`
3. 在 `META-INF/actiondock/plugins/{pluginId}.json` 中提供 Manifest

## 运行时交互

Groovy 和 Python 脚本都通过统一门面调用插件。

```groovy
def result = plugins.invoke("my-plugin", "hello", [
  name: "ActionDock"
])
```

```python
result = plugins.invoke("my-plugin", "hello", {
  "name": "ActionDock"
})
```

插件实现侧会收到：

- `action`：动作名
- `context`：脚本与执行上下文
- `args`：脚本传入参数

## 相关模块

- 插件模板见 [../actiondock-plugin-template/README.md](../actiondock-plugin-template/README.md)
- 运行时装配见 [../actiondock-app-support/README.md](../actiondock-app-support/README.md)
