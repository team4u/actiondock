# 插件查看与调用

使用 ActionDock CLI 查看插件、插件动作、插件配置，并调用插件动作。先遵守 `references/common.md` 的输出、连接、`--intent` 和参数传递规则。

脚本源码内 `plugins.invoke(...)` 见 `script-runtime-calls.md`；项目知识库浏览和 `actiondock-workspace` 见 `project-knowledge.md`。

## 渐进式浏览

插件信息按层级披露，从粗到细，避免一次性暴露所有 schema：

| 层级 | 命令 | 看到什么 |
|------|------|---------|
| L1 | `plugin list` | 插件名、版本、状态、动作数量 |
| L2 | `plugin get <id>` | 插件元信息和动作摘要 |
| L3 | `plugin action <id> <action>` | 单个动作完整 schema 和示例 |
| L4 | `plugin invoke <id> <action>` | 调用并返回结果 |

```bash
actiondock plugin list --intent "<regex>" --json
actiondock plugin get <plugin-id> --json
actiondock plugin action <plugin-id> <action> --json
actiondock plugin references --json
actiondock plugin config get <plugin-id> --json
```

- `plugin get` 只返回动作摘要，不含完整 `inputSchema` / `outputSchema`。
- `plugin action` 用于解释参数；顶层简单字段可扁平为 flag，对象/数组走 `--args-json` / `--args-file`。
- `plugin references` 返回脚本可引用的已启动插件动作摘要。

## 调用动作

推荐顺序：`plugin get` 找动作名，`plugin action` 看 schema，再 `plugin invoke`。

```bash
# 简单参数
actiondock plugin invoke my-plugin hello --name world --json

# 复杂参数
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --json

# 文件参数叠加动态 flag，flag 覆盖同名字段
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --topic override \
  --json

# 同时传脚本侧上下文
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --script-input-file ./script-input.json \
  --json

# 长结果或 debug 视图写文件
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --response-view debug \
  --json \
  --output-file /tmp/plugin-result.json \
  --overwrite-output
```

注意：`--input-json` / `--input-file` 只属于 `script run`，不要用于 `plugin invoke`。

## 调试判断

插件调用失败按顺序检查：

1. `plugin list --intent "<regex>"` 确认插件存在且已启动。
2. `plugin get <id>` 确认动作名。
3. `plugin action <id> <action>` 确认 `inputSchema`。
4. 对照 schema 检查 args 和是否需要 `scriptInput`。
5. AI 插件额外核对 `modelProfile` / `agentProfile`。

## 常见场景

```bash
# 渐进式浏览再调用
actiondock plugin list --intent "ai|workspace" --json
actiondock plugin get actiondock-ai --json
actiondock plugin action actiondock-ai chat --json
actiondock plugin invoke actiondock-ai chat \
  --args-json '{"modelProfile":"default-chat","messages":[{"role":"user","content":"hello"}]}' \
  --json

# 普通业务插件
actiondock plugin get my-plugin --json
actiondock plugin action my-plugin hello --json
actiondock plugin invoke my-plugin hello --name world --json
```
