# 脚本日志

ActionDock 为脚本提供了内置的 `log` 对象，用于在脚本执行过程中输出结构化日志。日志会被平台收集并持久化到执行记录中，可在执行历史中查看。

CLI 查看日志先遵守 `references/common.md`。

`log` 对象无需导入或声明，脚本引擎会自动注入，与 `input`、`config`、`plugins`、`scripts`、`state` 一样属于全局可用绑定。

---

## 日志级别

`log` 对象支持 4 个级别：

| 方法 | 级别 | 适用场景 |
|------|------|----------|
| `log.debug(message)` | DEBUG | 详细调试信息，如中间变量值、分支走向 |
| `log.info(message)` | INFO | 关键业务节点，如"开始处理"、"处理完成" |
| `log.warn(message)` | WARN | 非致命异常、可恢复的问题、降级逻辑 |
| `log.error(message)` | ERROR | 致命错误、无法继续处理的异常 |

日志级别在执行历史中可按级别筛选查看。

---

## Groovy 用法

```groovy
log.debug("处理开始, name=${input.name}")

def result = doSomething()

if (result.success) {
    log.info("处理成功, result=${result}")
} else {
    log.warn("处理降级, reason=${result.error}")
}
```

`message` 参数支持任意对象，非字符串会自动转为 `String.valueOf(...)`。

---

## Python 用法

```python
log.debug("处理开始, name=" + str(input.get("name")))

result = do_something()

if result.get("success"):
    log.info("处理成功, result=" + str(result))
else:
    log.warn("处理降级, reason=" + str(result.get("error")))
```

`message` 参数支持任意类型，非字符串会自动 `str()` 转换。

---

## 嵌套脚本调用中的日志前缀

当脚本 A 通过 `scripts.invoke(...)` 调用脚本 B 时，平台会自动为脚本 B 的日志添加前缀，格式为 `[script-A-id]`，便于在执行记录中区分日志来源。前缀由平台自动管理，脚本无需处理。

---

## 查看日志

脚本执行完成后，通过 CLI 查看日志：

```bash
actiondock execution get <executionId> \
  --json \
  --output-file /tmp/actiondock-execution-logs.json \
  --overwrite-output
```

返回结果中的 `logs` 数组包含所有日志条目，每条包含 `level`、`message` 和 `createdAt`。

---

## 注意事项

- 异常情况必须抛出异常，不要用 `log.error()` 代替 `throw`/`raise`。`log` 只用于记录过程信息，不用于错误控制流。静默吞掉异常会导致问题难以排查。
- 日志是同步写入的，大量日志会影响执行性能，生产脚本应避免在高频循环中输出 DEBUG 日志。
- 不要在日志中输出敏感信息（密码、Token、密钥等），因为日志会持久化到数据库。
- `message` 参数不要传入 `null`/`None`，虽然不会报错，但输出结果无意义。
