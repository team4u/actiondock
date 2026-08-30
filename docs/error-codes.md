# 错误代码与排错手册

# 错误 Envelope 契约结构

ActionDock 2.0 在执行 Action、解析配置、校验 Schema、编译构建或进行远程调度时，采用全局统一的结构化错误模型。

当命令执行失败或 Action 抛出异常时，`stdout` 将严格输出标准错误 Envelope，进程退出码为非 0（通常为 `1`）：

```json
{
  "ok": false,
  "runId": "01JXYZ...",
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "Input validation failed: 'prNumber' is a required property",
    "details": [
      {
        "instancePath": "",
        "schemaPath": "#/required",
        "keyword": "required",
        "params": { "missingProperty": "prNumber" },
        "message": "must have required property 'prNumber'"
      }
    ]
  }
}
```

---

# 标准错误代码清单

| 错误代码 | 场景与含义 | 常见触发原因 | 排错与修复建议 |
| :--- | :--- | :--- | :--- |
| `ACTION_NOT_FOUND` | 请求的 Action 标识不存在 | 命令行传入的 Action ID 拼写错误，或文件未在 `actions/` 目录中声明。 | * 运行 `ac action list` 查看可用 Action。<br>* 检查 `actions/*.ts` 中的 `id` 属性。 |
| `INPUT_VALIDATION_FAILED` | 入参不符合 `inputSchema` 定义 | 缺少必填字段、字段类型不匹配（如要求 number 却传入了 string）或未满足格式约束。 | * 运行 `ac action show <id>` 查看入参 Schema。<br>* 检查 `--input` 的 JSON 格式与字段类型。 |
| `OUTPUT_VALIDATION_FAILED` | Action 返回值不符合 `outputSchema` 定义 | Action 代码的 `run` 函数返回的数据结构缺少必填字段或类型与 Schema 声明不一致。 | * 检查 Action 源码中的 `return` 对象结构。<br>* 修正代码或调整 `outputSchema`。 |
| `ACTION_FAILED` | Action 业务执行抛出未捕获异常 | 外部网络请求失败（如 HTTP 500）、文件不存在、认证 Token 失效等运行时代码报错。 | * 查看 `stderr` 中的详细错误堆栈。<br>* 在 `run` 函数中增加 try-catch 进行防御性处理。 |
| `ACTION_CYCLE_DETECTED` | 跨 Action 组合调用时检测到循环依赖 | Action A 调用了 Action B，而 Action B 又反向调用了 Action A，造成无限死循环。 | * 检查 Action 间的调用链。<br>* 拆解公共逻辑为底层原子 Action，避免相互循环调用。 |
| `ACTION_TIMEOUT` | Action 执行时间超过设定阈值 | 执行 Action 时指定了 `--timeout`（如 `--timeout 30s`），底层执行耗时超出该限制。 | * 检查 Action 内部的网络请求或长耗时计算。<br>* 增大 `--timeout` 阈值，或在代码中使用 `ctx.signal` 加快响应式超时断开。 |
| `ACTION_CANCELLED` | Action 执行被外部主动终止 | 用户在终端按下 `Ctrl+C`、MCP 客户端发送了 `notifications/cancelled`、或调用了取消端点。 | * 正常终止场景，无需特殊修复。<br>* Action 内部应使用 `ctx.signal` 监听并释放网络连接与临时资源。 |
| `BUILD_FAILED` | 独立二进制编译失败 | 项目存在 TypeScript 语法错误、引用的模块不存在、或目标平台的交叉编译参数不合法。 | * 运行 `bun run typecheck` 检查全量类型错误。<br>* 查看编译失败时的具体编译器报错输出。 |
| `PLAYBOOK_VALIDATION_FAILED` | Playbook 语法或引用校验失败 | Playbook 的 Markdown 文件缺少 YAML Frontmatter，或 `actions` 中引用的 Action 在项目中不存在。 | * 运行 `ac playbook validate` 查看具体告警与错误行。<br>* 修正 Frontmatter 中的 `id` 与 `actions` 清单。 |
| `RUN_NOT_FOUND` | 查询或取消的 Run ID 不存在 | 传入了错误的 Run ID，或对应执行记录未在服务端存储中找到。 | * 运行 `ac runs list` 确认当前有效 Run ID。 |
| `RUN_ALREADY_FINISHED` | 取消已终态的执行任务 | 尝试取消一个已经处于 `success`、`failed` 或 `cancelled` 终态的任务。 | * 运行 `ac runs show <id>` 查看任务完成详情。 |
| `UNAUTHORIZED` | 远程 Runner 身份验证失败 | 访问受保护的 HTTP/MCP 服务端时未提供 Bearer Token，或 Token 不匹配。 | * 检查 `--token`、`--token-env` 或 `ACTIONDOCK_TOKEN` 是否配置正确。 |
| `REQUEST_TOO_LARGE` | 请求 Body 超过最大字节限制 | 向 HTTP Runner 发送了超过 `--max-body` 设定大小的请求体。 | * 启动 `ac serve` 时增大 `--max-body` 限制（如 `--max-body 5mb`），或避免在单次入参中传输超大二进制。 |

---

# 深度排障指引与修复方案

## `INPUT_VALIDATION_FAILED` 排查
- **原因分析**：ActionDock 底层基于 `Ajv` 执行严格的 JSON Schema 校验。如果传入的 JSON 属性类型与 Schema 不匹配（例如 Schema 声明 `"type": "number"`，而传入了 `"123"` 字符串），Ajv 会直接拦截并返回详细的 `details` 错误路径。
- **修复方案**：
  - 执行 `ac action show <actionId>` 查看完整的参数约束与必填字段。
  - 确保在传递数值、布尔值或对象时保持纯净 JSON 类型。

---

## `ACTION_CYCLE_DETECTED` 排查
- **原因分析**：当使用 `ctx.actions.invoke(childAction, input)` 组合调用其他 Action 时，ActionDock 会在内存执行栈中维护当前链路的所有 Action ID。如果链路上再次出现已在栈中的 Action ID，系统会立即触发循环依赖熔断。
- **修复方案**：
  - 梳理依赖关系，确保依赖图为**有向无环图** (DAG)。
  - 将公共逻辑提取为独立的通用工具函数或底层原子 Action。

---

## `ACTION_TIMEOUT` 与协作式取消排查
- **原因分析**：ActionDock 的超时机制通过 `Promise.race` 配合 `AbortController` 驱动。如果 Action 内部的网络请求（如 `fetch`）未绑定 `ctx.signal`，或在循环中未调用 `ctx.signal.throwIfAborted()`，底层 I/O 可能仍持续占用系统资源。
- **最佳实践修复**：
  ```ts
  // 正确：将 signal 传递给原生 fetch
  const res = await fetch(url, { signal: ctx.signal });

  // 正确：在密集循环中主动检查
  for (const row of rows) {
    ctx.signal.throwIfAborted();
    await handleRow(row);
  }
  ```

---

## `UNAUTHORIZED` 远程鉴权失败排查
- **原因分析**：`ac serve` 启用了 Bearer Token 验证，且禁用了不安全的 URL Query Token。
- **排查步骤**：
  - 确认请求头中包含 `Authorization: Bearer <token>`。
  - 本地执行 `ac profile show <name> --reveal` 确认本地记录的 Token 与远端 `ac serve` 启动时配置的 Token 是否完全一致。
  - 若远端绑定了非 `127.0.0.1` 地址（如 `0.0.0.0`），确保启动时传入了有效 Token。

---

# 文档导航

- [CLI 命令行参考手册](cli-reference.md)：查看各命令支持的参数与选项。
- [安全加固与执行生命周期设计](design-security-mcp-execution.md)：深入学习错误流转与生命周期状态机。
- [测试与验证指南](testing-guide.md)：通过单测提前发现并防御运行时错误。
