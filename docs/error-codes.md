# 错误代码与排错手册

ActionDock 2.0 在执行 Action、解析配置、校验 Schema 及编译构建时，采用统一的结构化错误模型。

本文档汇总了 ActionDock 所有的标准错误代码、触发原因以及排错修复建议。

---

## 错误 Envelope 结构

当 ActionDock 命令或 Action 执行失败时，`stdout` 将输出标准的错误 Envelope，进程退出码为非 0（通常为 1）：

```json
{
  "ok": false,
  "runId": "01J...",
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

## 标准错误代码清单

| 错误代码 (Error Code) | 场景与含义 | 常见触发原因 | 排错与修复建议 |
| :--- | :--- | :--- | :--- |
| **`ACTION_NOT_FOUND`** | 请求的 Action 标识不存在 | 命令行传入的 Action ID 拼写错误，或该 Action 对应的 `.ts` 文件未在 `actions/` 目录中声明。 | * 运行 `ac action list` 查看项目中所有可用的 Action。<br>* 检查 `actions/*.ts` 文件中的 `id` 声明是否匹配。 |
| **`INPUT_VALIDATION_FAILED`** | 输入参数不符合 `inputSchema` 定义 | 传入的入参 JSON 缺少必填字段、字段类型不匹配（如要求 number 却传入了 string）或未满足格式限制。 | * 运行 `ac action show <id>` 查看入参 Schema 规范。<br>* 检查 `--input` JSON 字符串格式是否合法。 |
| **`OUTPUT_VALIDATION_FAILED`** | Action 返回值不符合 `outputSchema` 定义 | Action 代码的 `run` 函数返回的数据结构缺少必填字段或类型与 Schema 声明不一致。 | * 检查 Action 源码中 `return` 的对象结构。<br>* 调整 `outputSchema` 或修正业务代码。 |
| **`ACTION_FAILED`** | Action 业务执行过程中抛出未捕获异常 | 外部网络请求失败（如 HTTP 500）、文件不存在、认证 Token 失效等运行时代码报错。 | * 查看 `stderr` 中的详细日志与错误堆栈信息。<br>* 在 `run` 函数中增加 try-catch 进行防御性处理。 |
| **`ACTION_CYCLE_DETECTED`** | 跨 Action 组合调用时检测到循环依赖 | Action A 调用了 Action B，而 Action B（或链路下游）又反向调用了 Action A，造成无限递归调用死循环。 | * 检查 Action 间的调用链。<br>* 拆解公共依赖为底层的原子 Action，避免双向相互调用。 |
| **`ACTION_TIMEOUT`** | Action 执行时间超过设定阈值 | 执行 Action 时指定了 `--timeout`（如 `--timeout 30s`），底层执行耗时超出该限制。 | * 检查 Action 内部的网络请求或长耗时计算。<br>* 增加 `--timeout` 阈值，或在代码中使用 `ctx.signal` 加快响应式超时断开。 |
| **`ACTION_CANCELLED`** | Action 执行被外部主动终止 | 用户在终端按下 `Ctrl+C`、MCP 客户端发送了 `notifications/cancelled`、或调用了执行句柄的 `cancel()`。 | * 正常终止场景，无需特殊修复。<br>* Action 内部应使用 `ctx.signal` 监听并释放网络连接与临时文件等资源。 |
| **`BUILD_FAILED`** | 独立二进制编译失败 | 项目存在 TypeScript 语法错误、引用的模块不存在、或目标平台的交叉编译参数不合法。 | * 运行 `bun run typecheck` 检查全量类型错误。<br>* 查看编译失败时的具体编译器报错输出。 |
| **`PLAYBOOK_VALIDATION_FAILED`** | Playbook 语法或引用校验失败 | Playbook 的 Markdown 文件缺少 YAML Frontmatter，或 `actions` 中引用的 Action 在项目中不存在。 | * 运行 `ac playbook validate` 查看具体告警与错误行。<br>* 修正 Frontmatter 中的 `id` 与 `actions` 清单。 |
