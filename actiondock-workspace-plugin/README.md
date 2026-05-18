# actiondock-workspace-plugin

把工作区文件与 Shell 能力桥接成一个系统插件 `actiondock-workspace`，让 Groovy 和 Python 脚本通过统一的 `plugins.invoke(...)` 门面直接访问受限目录。

## 暴露方式

这个模块不要求用户单独安装插件 JAR。平台启动后会把它作为内置系统插件暴露给脚本运行时。

## 主要动作

- `listDirectory`
- `viewTextFile`
- `writeTextFile`
- `insertTextFile`
- `getSystemInfo`
- `executeShellCommand`

## Groovy 调用示例

```groovy
def result = plugins.invoke("actiondock-workspace", "viewTextFile", [
  path: "README.md",
  viewRange: "1,20"
])

return [content: result.content]
```

## Python 调用示例

```python
result = plugins.invoke("actiondock-workspace", "listDirectory", {
  "path": "."
})

return {"files": result["files"]}
```

## 环境探测示例

```groovy
def result = plugins.invoke("actiondock-workspace", "getSystemInfo", [
  additionalCommands: ["docker", "uv"]
])

return [
  os: result.system.osName,
  commands: result.commands
]
```

## 使用约定

- 对外接口统一使用 Java 驼峰风格动作名和参数名
- `path` / `cwd` 默认相对当前工作目录解析
- 所有路径访问都限制在 `baseDir` 范围内
- `writeTextFile` 通过 `ranges` 支持局部替换
- `getSystemInfo` 默认只返回 PATH 拆分、shell/命令探测结果，不暴露完整环境变量

## 相关模块

- 插件 SPI 见 [../actiondock-plugin-api/README.md](../actiondock-plugin-api/README.md)
- AI 系统插件桥接见 [../actiondock-ai-plugin-bridge/README.md](../actiondock-ai-plugin-bridge/README.md)
