# 插件查看与调用

使用 ActionDock CLI 查看插件、插件动作和插件配置，并调用某个插件动作。

本文件只覆盖 `plugin` 命令。脚本执行见 `references/script-execution.md`，脚本源码内 `plugins.invoke(...)` 见 `references/script-runtime-calls.md`。

专项系统插件的场景化指引见：

- 项目知识库浏览 / `actiondock-workspace`：`references/project-knowledge.md`

---

## 1. 渐进式浏览插件

插件信息按层级披露，从粗到细，避免一次性暴露所有 schema 噪音：

| 层级 | 命令 | 看到什么 |
|------|------|---------|
| L1 | `plugin list` | 所有插件名、版本、动作数量 |
| L2 | `plugin get <id>` | 插件元信息 + 动作名/标题/一行描述 |
| L3 | `plugin action <id> <action>` | 单个动作的完整 inputSchema / outputSchema / exampleArgs |
| L4 | `plugin invoke <id> <action>` | 调用并返回结果 |

### L1: 列出已安装插件

```bash
actiondock plugin list --json
actiondock plugin list --intent "<regex>" --json
```

适合回答：当前装了哪些插件、插件是否已启动、动作数量。
`--intent` 按插件 ID、名称、版本和描述做正则搜索；未命中时 CLI 自动退回全量插件摘要列表。

### L2: 查看某个插件的全部动作（无 schema）

```bash
actiondock plugin get <plugin-id>
actiondock plugin get <plugin-id> --json
```

文本模式展示每个动作的名称、标题和描述。`--json` 同样只返回 `{ action, title, description }`，不包含 inputSchema / outputSchema。

需要某个动作的详细 schema 时，进入 L3。

### L3: 查看单个动作的完整 schema

```bash
actiondock plugin action <plugin-id> <action>
actiondock plugin action <plugin-id> <action> --json
```

文本模式展示：
- Input: 每个参数的 `--name <type> [required] [default=X]` + 描述
- JSON-only fields: 不适合扁平 flag 的对象/数组字段
- Output: 完整 outputSchema
- Example: exampleArgs 示例

解释 action schema 时，直接把 Input 里的顶层简单字段理解成可扁平的 CLI flag，把 `JSON-only fields` 理解成必须走 `--args-json` / `--args-file` 的字段。

默认附 1 条对应的 `plugin invoke` 示例：纯简单字段时示例用扁平 flag；存在对象或数组字段时示例直接用 `--args-json` 或 `--args-file`。

`--json` 返回单个动作的完整 `PluginActionDefinition` 对象（含 inputSchema、outputSchema、exampleArgs）。

动作不存在时会列出所有可用动作名称。

### 查看脚本可引用的插件

```bash
actiondock plugin references --json
```

返回所有已启动插件的动作摘要（只有 action / title / description），不含 schema。

### 查看插件当前配置

```bash
actiondock plugin config get <plugin-id> --json
```

---

## 2. 调用插件动作

标准形式：

```bash
actiondock plugin invoke <plugin-id> <action> --json
```

推荐顺序：

1. `plugin get <plugin-id>` — 找到目标动作名
2. `plugin action <plugin-id> <action>` — 查看 inputSchema
3. 先区分哪些字段可扁平，哪些字段必须用 JSON / 文件输入
4. 再执行 `plugin invoke`

默认优先使用扁平入参，也就是把简单顶层字段直接展开成普通 flag。只有遇到对象、数组，或者终端里不适合内联的大 JSON，再退回 `--args-json` / `--args-file`。

插件调用有三类输入，不能混用错：

- action args 简单字段：直接用动态 flag，例如 `--name world`
- action args 复杂字段：用 `--args-json` / `--args-file`
- 脚本上下文：用 `--script-input-json` / `--script-input-file`

`--input-json` / `--input-file` 只属于 `script run`，不要用于 `plugin invoke`。

### 简单参数：直接用动态 flag

适用于顶层 string / number / integer / boolean / enum 字段：

```bash
actiondock plugin invoke my-plugin hello --name world --json
actiondock plugin invoke my-plugin summarize --topic ops --priority 3 --json
```

`--server`、`--token`、`--profile` 是连接参数保留字，不会作为 action 动态参数传入；如果 action 参数同名，使用 `--args-json` / `--args-file`。

### 复杂参数：优先使用 `--args-json` 或 `--args-file`

对象或数组字段不要硬拆成动态 flag，直接传 JSON：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-json '{"topic":"ops","filters":{"env":"prod"}}' \
  --json
```

对较复杂输入，优先写文件：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --json
```

如果 schema 或结果内容本身很长，也优先把输出写文件：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --json \
  --output-file /tmp/plugin-result.json \
  --overwrite-output
```

### 混合传参

`--args-json` / `--args-file` 提供基础 action args 对象，动态 flag 会合并进去并覆盖同名字段：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --topic override \
  --json
```

### 同时传脚本上下文

有些插件动作会读取 `scriptInput` 作为脚本侧上下文。此时额外传：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-json '{"topic":"ops"}' \
  --script-input-json '{"locale":"zh-CN"}' \
  --json
```

或：

```bash
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --script-input-file ./script-input.json \
  --json
```

---

## 3. 调试与结果判断

### 获取更详细返回

```bash
actiondock plugin invoke <plugin-id> <action> \
  --args-json '<args-json>' \
  --response-view debug \
  --json
```

适合查看：
- 实际传入的 `args`
- 实际传入的 `scriptInput`
- 插件返回结果

### 常见判断顺序

1. 插件是否存在：先看 `plugin list --intent "<regex>"`
2. 动作列表：看 `plugin get <id>`
3. 动作 schema 详情：看 `plugin action <id> <action>`
4. 入参是否匹配：对照 inputSchema
5. 是否需要 `scriptInput`
6. 如果是 AI 插件，再核对 `modelProfile` / `agentProfile`

---

## 4. 常见场景

### 渐进式浏览再调用

```bash
actiondock plugin list --intent "ai|workspace" --json
actiondock plugin get actiondock-ai
actiondock plugin action actiondock-ai chat
actiondock plugin invoke actiondock-ai chat --args-json '{"modelProfile":"default-chat","messages":[{"role":"user","content":"hello"}]}' --json
```

### 调一个普通业务插件

```bash
actiondock plugin get my-plugin
actiondock plugin action my-plugin hello
actiondock plugin invoke my-plugin hello --name world --json
```

### 复杂对象入参

```bash
actiondock plugin action my-plugin summarize
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --script-input-file ./script-input.json \
  --response-view debug \
  --json
```
