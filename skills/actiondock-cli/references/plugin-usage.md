# 插件查看与调用

使用 ActionDock CLI 查看插件、插件动作和插件配置，并调用某个插件动作。

本文件只覆盖 `plugin` 命令。脚本执行见 `references/script-execution.md`，脚本源码内 `plugins.invoke(...)` 见 `references/script-runtime-calls.md`。

---

## 1. 先确认插件信息

### 列出已安装插件

```bash
actiondock plugin list --json
```

适合回答这些问题：

- 当前装了哪些插件
- 插件是否已启动
- 插件版本是什么
- 动作数量（`actionCount`）

`plugin list` 只返回插件摘要，不返回 action schema。需要参数结构时使用 `plugin get <plugin-id> --json`。

### 查看某个插件详情

```bash
actiondock plugin get <plugin-id> --json
```

重点看：

- `actions`
- 每个 action 的 `inputSchema`
- 每个 action 的 `outputSchema`
- `description`
- `exampleArgs`

### 查看脚本可引用的插件

```bash
actiondock plugin references --json
```

当用户想在脚本源码里写 `plugins.invoke(...)` 时，优先用这个命令确认：

- 可用的 `pluginId`
- 每个插件暴露了哪些 action

### 查看插件当前配置

```bash
actiondock plugin config get <plugin-id> --json
```

适合排查：

- 为什么插件行为和预期不一致
- 某个 action 是否依赖插件配置

---

## 2. 调用插件动作

标准形式：

```bash
actiondock plugin invoke <plugin-id> <action> --json
```

推荐顺序：

1. `plugin get <plugin-id> --json`
2. 找到目标 action 的 `inputSchema`
3. 决定用动态 flag 还是 JSON / 文件输入
4. 再执行 `plugin invoke`

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

1. 插件是否存在：先看 `plugin list` / `plugin get`
2. action 是否存在：看 `plugin.get(...).actions`
3. 入参是否匹配：对照 `inputSchema`
4. 是否需要 `scriptInput`
5. 如果是 AI 插件，再核对 `modelProfile` / `agentProfile`

---

## 4. 常见场景

### 先找插件再调用

```bash
actiondock plugin references --json
actiondock plugin get actiondock-ai --json
actiondock plugin invoke actiondock-ai chat --args-json '{"modelProfile":"default-chat","messages":[{"role":"user","content":"hello"}]}' --json
```

### 调一个普通业务插件

```bash
actiondock plugin get my-plugin --json
actiondock plugin invoke my-plugin hello --name world --json
```

### 复杂对象入参

```bash
actiondock plugin invoke my-plugin summarize \
  --args-file ./plugin-args.json \
  --script-input-file ./script-input.json \
  --response-view debug \
  --json
```
