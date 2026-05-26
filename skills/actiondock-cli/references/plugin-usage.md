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

如果插件 action 很多，或 schema 很大，优先直接写入文件，避免终端响应截断：

```bash
actiondock plugin get <plugin-id> --json > /tmp/<plugin-id>.plugin.json
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
  --json > /tmp/plugin-result.json
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

### 浏览器插件：优先走扁平顶层字段，`target` 再单独用 JSON

浏览器插件是最适合先看 schema 再调用的一类插件。推荐工作流：

1. `sessionCreate`
2. `goto`
3. `observe`
4. 用 `observe.elements[].ref` 回填 `target.ref`
5. 对元素执行 `click` / `fill` / `setChecked` 等动作

浏览器插件的 schema 和 action 列表通常较长，优先输出到文件：

```bash
actiondock plugin get actiondock-browser --json > /tmp/actiondock-browser.plugin.json
actiondock plugin invoke actiondock-browser capabilities --json > /tmp/actiondock-browser.capabilities.json
```

如果只是顶层简单字段，直接用扁平 flag：

```bash
actiondock plugin invoke actiondock-browser sessionCreate \
  --browser chromium \
  --headless \
  --json

actiondock plugin invoke actiondock-browser goto \
  --sessionId br_xxx \
  --url https://example.com \
  --json

actiondock plugin invoke actiondock-browser observe \
  --sessionId br_xxx \
  --limit 80 \
  --json > /tmp/browser-observe.json
```

`observe` 返回的是页面摘要，适合读取 `visibleText`、`elements`、`forms`、`ariaSnapshot` 等结构化信息，不返回完整页面源码。需要完整 HTML 或正文文本时，用 `evaluate`，并优先把输出写入文件：

```bash
actiondock plugin invoke actiondock-browser evaluate \
  --sessionId br_xxx \
  --expression '() => document.documentElement.outerHTML' \
  --json > /tmp/page-html.json

actiondock plugin invoke actiondock-browser evaluate \
  --sessionId br_xxx \
  --expression '() => document.body?.innerText || ""' \
  --json > /tmp/page-text.json
```

`observe` 返回的元素定位对象是复杂字段，后续优先把 `target` 放进 `--args-json` 或 `--args-file`，而不是尝试拆成多个 flag：

```bash
actiondock plugin invoke actiondock-browser fill \
  --sessionId br_xxx \
  --value 'hello@example.com' \
  --args-json '{"target":{"ref":"e3"}}' \
  --json
```

对更稳定、可复用的浏览器动作，优先写文件：

```bash
cat > /tmp/browser-fill.json <<'JSON'
{
  "target": { "ref": "e3" }
}
JSON

actiondock plugin invoke actiondock-browser fill \
  --sessionId br_xxx \
  --value 'hello@example.com' \
  --args-file /tmp/browser-fill.json \
  --json
```

补充约定：

- `sessionId`、`pageId`、`url`、`value`、`checked`、`timeoutMs` 这类简单顶层字段，优先直接写 flag。
- `target`、`destination`、`headers`、`cookies`、`viewport`、`geolocation` 这类对象或数组字段，优先 `--args-file`。
- 复选框和单选框不要用 `fill`，改用 `setChecked` / `check` / `uncheck`。
- 页面跳转、弹窗、明显 DOM 变化后，先重新 `observe`，再使用新的 `target.ref`。
