# 脚本日常执行

查找和运行已发布的 ActionDock 脚本。先遵守 `references/common.md` 的输出、连接、`--intent` 和 schema 传参规则。

相关文档：插件调用见 `plugin-usage.md`；执行历史见 `execution-history.md`；定时任务见 `schedule-management.md`。

## 查找脚本

```bash
actiondock script list --intent "<regex>" --json
actiondock script schema <script-id> --json
actiondock script get <script-id> --json
```

- `script list` 默认只列出有已发布快照的脚本；加 `--all` 可包含仅有草稿的脚本。
- 第一次执行前先看 `script schema`，按 common 规则区分扁平 flag 与 `--input-json` / `--input-file`。
- `script get` 用于查看完整定义；加 `--draft` 查看草稿版本。

## 执行脚本

简单顶层字段直接用动态 flag：

```bash
actiondock script run <script-id> --name alice --count 3 --json
```

复杂输入优先写文件：

```bash
actiondock script run <script-id> --input-file /tmp/my-script-input.json --json
```

其他常用形式：

```bash
# 基础输入来自文件，动态 flag 覆盖同名字段
actiondock script run <script-id> --input-file /tmp/base-input.json --name override --json

# 简单场景可内联 JSON，但复杂 JSON 不推荐
actiondock script run <script-id> --input-json '{"name":"alice"}' --json

# 长任务异步提交，返回 execution ID 后用 execution get 查询
actiondock script run <script-id> --mode async --input-file ./input.json --json

# 调试草稿
actiondock script run <script-id> --draft --input-file ./input.json --json

# 长 debug 输出写文件
actiondock script run <script-id> \
  --response-view debug \
  --input-file ./input.json \
  --json \
  --output-file /tmp/actiondock-script-run.json \
  --overwrite-output
```

动态 flag 会按 `inputSchema` 自动转换 integer、number、boolean 和 enum。

## 失败判断

执行失败先看：

- `status`
- `errorMessage`
- `errorDetail.stackTrace`
- `errorDetail.details.code`
- `logs`

异步执行或长结果用：

```bash
actiondock execution get <execution-id> \
  --json \
  --output-file /tmp/actiondock-execution.json \
  --overwrite-output
```

Python 常见失败码：

| code | 优先判断 |
|------|----------|
| `PYTHON_RUNTIME_MISSING` | 服务端是否缺少 `python3` |
| `PYTHON_ENV_PREPARE_FAILED` | 服务端是否缺少 `python3 -m venv` |
| `PYTHON_DEP_INSTALL_FAILED` | `pythonRequirements` / `requirements.txt` 是否正确 |
| `PYTHON_EXECUTION_FAILED` | 依赖已准备完成，再结合堆栈、日志修源码 |

处理原则：

- 输入不合法：先修输入或 `inputSchema`。
- Python 环境/依赖失败：先修运行环境或 `pythonRequirements`。
- 脚本逻辑失败：回作者态修源码。
- 输出结构不对：同时核对源码和 `outputSchema`。

## 典型工作流

```bash
# 执行已知脚本
actiondock script schema my-script --json
actiondock script run my-script --name alice --count 3 --json

# 查找并执行陌生脚本
actiondock script list --intent "<regex>" --json
actiondock script schema target-script --json
actiondock script run target-script --input-file ./input.json --json

# 长时间脚本
actiondock script run heavy-script --mode async --input-file ./input.json --json
```
