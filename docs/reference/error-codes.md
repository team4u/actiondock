# 参考手册：错误代码与排错速查

ActionDock 采用确定性的结构化错误体系，所有失败均通过 JSON Envelope 输出到 `stdout`，并附带机器可解析的错误代码与上下文明细。

---

## 错误 Envelope 结构

```json
{
  "ok": false,
  "runId": "01JMB394...",
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "入参校验失败: /prNumber must be number",
    "details": [
      {
        "instancePath": "/prNumber",
        "schemaPath": "#/properties/prNumber/type",
        "keyword": "type",
        "message": "must be number"
      }
    ]
  }
}
```

---

## 错误代码字典

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `INPUT_VALIDATION_FAILED` | 422 | 传入的 input 违反了 Action 的 `inputSchema` 约束（如缺少必填字段、类型错误）。 | 检查调用传参，参照 Action 的 Schema 修正字段。 |
| `OUTPUT_VALIDATION_FAILED` | 500 | Action 函数返回值违反了 `outputSchema` 约束。 | 检查 Action 内部实现，确保返回值符合出参契约。 |
| `ACTION_NOT_FOUND` | 404 | 指定的 Action ID 不存在于当前包或注册表中。 | 检查 Action ID 拼写，或执行 `ac info` 查看已注册的 Action 列表。 |
| `ACTION_TIMEOUT` | 504 | Action 执行耗时超过了设定的最大超时阈值。 | 检查网络 I/O 是否卡住，或在调用时调大 `--timeout`。 |
| `ACTION_CYCLE_DETECTED` | 508 | 级联调用中检测到递归循环依赖（A -> B -> A）。 | 检查 Action 级联逻辑，消除相互循环调用。 |
| `ACTION_EXECUTION_FAILED` | 500 | Action 内部抛出了未捕获的运行时异常（如网络异常、语法错误）。 | 查看 `stderr` 输出的日志与堆栈定位报错代码。 |
| `CONFIG_VALIDATION_FAILED` | 422 | 运行时缺失了 `actiondock.json` 中声明的必填配置项。 | 执行 `ac config set` 或设置对应的环境变量。 |
| `STORAGE_ERROR` | 500 | 内嵌 SQLite 读写失败或锁冲突。 | 检查磁盘剩余空间与 `.actiondock/actiondock.db` 文件读写权限。 |
| `UNAUTHORIZED` | 401 | 访问受保护的 HTTP 服务时未提供有效的 Token。 | 检查请求头 `Authorization: Bearer <token>` 是否正确。 |
| `FORBIDDEN` | 403 | 非回环地址请求未通过鉴权。 | 配置正确的访问 Token。 |
