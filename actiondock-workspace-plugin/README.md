# actiondock-workspace-plugin

把工作区文件与 Shell 能力桥接成一个系统插件 `actiondock-workspace`，让 Groovy 和 Python 脚本通过统一的 `plugins.invoke(...)` 门面访问文件工具和本机命令执行能力。

## 暴露方式

这个模块不要求用户单独安装插件 JAR。平台启动后会把它作为内置系统插件暴露给脚本运行时。

## 主要动作

- `listDirectory`
- `viewTextFile`
- `writeTextFile`
- `insertTextFile`
- `findFiles`
- `searchText`
- `getSystemInfo`
- `exec`

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

## 文件发现示例

```groovy
def result = plugins.invoke("actiondock-workspace", "findFiles", [
  path: ".",
  includeGlobs: ["**/*.java"],
  excludeGlobs: ["**/*Test.java"]
])

return [files: result.files]
```

## 文本搜索示例

```python
result = plugins.invoke("actiondock-workspace", "searchText", {
  "query": "TODO|FIXME",
  "path": ".",
  "includeGlobs": ["**/*.java"],
  "contextLines": 1
})

return {"matches": result["matches"]}
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

## Shell 执行示例

```groovy
def result = plugins.invoke("actiondock-workspace", "exec", [
  command: "git status --short",
  cwd: ".",
  timeoutSeconds: 30,
  check: false,
  shell: "auto"
])

return [
  ok: result.ok,
  stdout: result.stdout,
  stderr: result.stderr,
  exitCode: result.exitCode
]
```

## 使用约定

- 对外接口统一使用 Java 驼峰风格动作名和参数名
- 文件动作的 `path` 默认相对当前工作目录解析
- 文件动作的路径访问限制在 `baseDir` 范围内
- `exec` 复用脚本运行时 `shell.exec` 的执行能力，支持 `cwd` / `env` / `timeoutSeconds` / `check` / `shell` / `maxOutputBytes`
- `exec` 的 `cwd` 默认是进程工作目录；显式传入时目录必须已存在，框架不自动创建或清理运行目录
- `writeTextFile` 通过 `ranges` 支持局部替换
- `findFiles` / `searchText` 默认跳过 `.git`、`target`、`node_modules` 等常见生成目录，并会轻量处理 `.gitignore`
- `searchText` 默认使用正则匹配；如需普通字符串搜索，传入 `regex: false`
- `getSystemInfo` 默认只返回 PATH 拆分、shell/命令探测结果，不暴露完整环境变量

## 相关模块

- 插件 SPI 见 [../actiondock-plugin-api/README.md](../actiondock-plugin-api/README.md)
- AI 系统插件桥接见 [../actiondock-ai-plugin-bridge/README.md](../actiondock-ai-plugin-bridge/README.md)
