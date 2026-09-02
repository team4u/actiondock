# 底层架构：标准输出与错误通道的物理隔离

在为 AI Agent（如 Claude Code、Cursor、Antigravity）构建工具时，最常见的致命故障之一是 **输出通道污染**。

---

## 传统工具脚本的日志污染问题

传统的脚本或工具中，开发者常常随手书写 `console.log()` 或 `print()`，或者第三方依赖库在初始化时打印版本号横幅（Banner）。

```text
[传统脚本输出 stdout]
Checking database connection...
Initialized SDK v1.2.3
{"result": "success", "count": 42}
```

当大模型或下游管道尝试使用 `JSON.parse()` 解析结果时，非 JSON 字符将直接导致解析异常（SyntaxError），导致整个 Agent 规划链路中断崩溃。

---

## ActionDock 的物理通道隔离方案

ActionDock 从架构底层严格分离两个通道的职责：

```text
               ┌── stdout (数据通道) ──> 纯净标准 JSON Envelope (供 LLM/程序解析)
Action 执行 ───┤
               └── stderr (诊断通道) ──> 格式化日志、警告、堆栈与终端着色 (供人类排错)
```

### 标准输出通道 (`stdout`)
- 严格仅输出机器可读的 **JSON Envelope**。
- 绝不包含任何 ANSI 颜色控制字符、无意义换行或调试文本。
- 无论执行成功或失败，始终输出形如 `{"ok": true, ...}` 或 `{"ok": false, "error": {...}}` 的纯净 JSON。

### 标准错误通道 (`stderr`)
- Action 内通过 `ctx.log.info()` 等方法打印的业务日志统一经过格式化（包含毫秒级时间戳、日志级别、Action ID）后输出至 `stderr`。
- CLI 的进度提示、Spinner 动画与未捕获异常的完整调用栈均流向 `stderr`。

---

## 管道组合与自动化验证

由于两个通道物理隔离，您可以将 ActionDock 命令无缝串联进 Unix 管道或 jq 过滤器：

```bash
# 纯净提取 data 字段，即使 stderr 中有大量日志，jq 也绝不报错
ac run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}' | jq .data.title
```
