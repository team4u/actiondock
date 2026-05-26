# 浏览器自动化

当用户需要打开网页、读取页面内容、点击元素、填写表单、处理弹窗/下载，或通过浏览器上下文发起请求时，使用 `actiondock-browser` 插件。

本插件保持 ActionDock 插件调用体系：

```bash
actiondock plugin invoke actiondock-browser <action> --flag value --json
```

设计原则：一个 action 表达一个清晰语义；入参保持扁平。不要使用嵌套 `target` 对象，也不要用通用 `--op` 字段。

## 标准工作流

```bash
actiondock plugin invoke actiondock-browser open --json
actiondock plugin invoke actiondock-browser open --session <open返回的session> --url https://example.com --json
actiondock plugin invoke actiondock-browser snapshot --session <open返回的session> --limit 80 --json > /tmp/browser-snapshot.json
```

`open` 不传 `--session` 时会自动生成并返回 `session`。`open` 也可以不传 `--url`，用于先创建浏览器上下文，再设置 Cookie、Storage 或网络规则。后续动作必须传这个返回值。`snapshot` 返回：

- `url` / `title`
- `visibleText`
- `ariaSnapshot`
- `elements[].ref`，格式为 `@e1`
- `forms`
- `frames`
- `events`
- `suggestions`

后续操作直接把 `elements[].ref` 作为字符串传给 `--target`：

```bash
actiondock plugin invoke actiondock-browser click --session <open返回的session> --target @e2 --json
```

## 目标选择器

`--target` 是一个字符串：

- `@e1`: 来自最近一次 `snapshot` 的元素引用
- `#submit` / `.item`: CSS selector
- `css:button.primary`: 显式 CSS selector

语义定位使用专门 action：

```bash
actiondock plugin invoke actiondock-browser findClick --session run1 \
  --by role \
  --query button \
  --name Submit \
  --json

actiondock plugin invoke actiondock-browser findFill --session run1 \
  --by label \
  --query Email \
  --text hello@example.com \
  --json
```

可用 `--by`：`role`、`text`、`label`、`placeholder`、`alt`、`title`、`testid`、`css`。

## 常用动作

### 点击和输入

```bash
actiondock plugin invoke actiondock-browser click --session run1 --target @e2 --json
actiondock plugin invoke actiondock-browser dblclick --session run1 --target @e2 --json
actiondock plugin invoke actiondock-browser fill --session run1 --target @e3 --text hello@example.com --json
actiondock plugin invoke actiondock-browser type --session run1 --target @e3 --text hello --json
actiondock plugin invoke actiondock-browser press --session run1 --key Enter --json
```

复选框和单选框：

```bash
actiondock plugin invoke actiondock-browser check --session run1 --target @e4 --json
actiondock plugin invoke actiondock-browser uncheck --session run1 --target @e4 --json
```

选择框、上传、拖拽：

```bash
actiondock plugin invoke actiondock-browser select --session run1 --target @e5 --value US --json
actiondock plugin invoke actiondock-browser upload --session run1 --target @e6 --path ./upload.txt --json
actiondock plugin invoke actiondock-browser drag --session run1 --target @e1 --to @e2 --json
```

### 读取和判断

```bash
actiondock plugin invoke actiondock-browser getTitle --session run1 --json
actiondock plugin invoke actiondock-browser getUrl --session run1 --json
actiondock plugin invoke actiondock-browser getText --session run1 --target @e1 --json
actiondock plugin invoke actiondock-browser getAttr --session run1 --target @e1 --name href --json

actiondock plugin invoke actiondock-browser isVisible --session run1 --target @e1 --json
actiondock plugin invoke actiondock-browser isEnabled --session run1 --target @e1 --json
actiondock plugin invoke actiondock-browser isChecked --session run1 --target @e1 --json
```

### 等待

```bash
actiondock plugin invoke actiondock-browser waitForLoad --session run1 --state load --json
actiondock plugin invoke actiondock-browser waitForElement --session run1 --target @e1 --state visible --json
actiondock plugin invoke actiondock-browser waitForText --session run1 --text Welcome --json
actiondock plugin invoke actiondock-browser waitForUrl --session run1 --url '**/dashboard' --json
actiondock plugin invoke actiondock-browser waitForResponse --session run1 --value '**/api/**' --json
actiondock plugin invoke actiondock-browser waitForTimeout --session run1 --timeoutMs 1000 --json
```

页面跳转或明显 DOM 更新后，重新 `snapshot`，再使用新的 `@e1` 引用。

## 会话和 Tab

`open` 可以不传 `--session`，插件会自动生成一个公开 session 名并返回；也可以不传 `--url`，只创建浏览器上下文。后续浏览器上下文动作必须显式传这个返回值：

```bash
actiondock plugin invoke actiondock-browser open --json
actiondock plugin invoke actiondock-browser snapshot --session <open返回的session> --json
```

如果需要固定名字复用，也可以在 `open` 时显式传 `--session run1`。`sessionList` 是例外，不需要 `--session`。

Tab：

```bash
actiondock plugin invoke actiondock-browser tabList --session run1 --json
actiondock plugin invoke actiondock-browser tabNew --session run1 --url https://docs.example.com --label docs --json
actiondock plugin invoke actiondock-browser tabSwitch --session run1 --tab docs --json
actiondock plugin invoke actiondock-browser tabClose --session run1 --tab docs --json
```

查看或关闭会话：

```bash
actiondock plugin invoke actiondock-browser sessionInfo --session run1 --json
actiondock plugin invoke actiondock-browser sessionList --json
actiondock plugin invoke actiondock-browser sessionClose --session run1 --json
```

## 截图、PDF、弹窗

```bash
actiondock plugin invoke actiondock-browser screenshot --session run1 --name page --fullPage true --json
actiondock plugin invoke actiondock-browser screenshot --session run1 --target @e1 --name element --json
actiondock plugin invoke actiondock-browser pdf --session run1 --name page --format A4 --json
```

Dialog：

```bash
actiondock plugin invoke actiondock-browser dialogList --session run1 --json
actiondock plugin invoke actiondock-browser dialogAccept --session run1 --id d1 --json
actiondock plugin invoke actiondock-browser dialogDismiss --session run1 --id d1 --json
```

## Cookie、Storage、网络

```bash
actiondock plugin invoke actiondock-browser cookiesList --session run1 --json
actiondock plugin invoke actiondock-browser cookiesSet --session run1 --name sid --value 1 --url https://example.com --json
actiondock plugin invoke actiondock-browser cookiesClear --session run1 --json

actiondock plugin invoke actiondock-browser storageState --session run1 --stateName login --json
actiondock plugin invoke actiondock-browser storageGet --session run1 --area local --key token --json
actiondock plugin invoke actiondock-browser storageSet --session run1 --area local --key token --value abc --json
actiondock plugin invoke actiondock-browser storageClear --session run1 --area local --json

actiondock plugin invoke actiondock-browser networkRequest --session run1 --url https://example.com/api/me --method GET --json
actiondock plugin invoke actiondock-browser networkRoute --session run1 --url '**/*.png' --routeAction abort --json
actiondock plugin invoke actiondock-browser networkOffline --session run1 --value true --json
```

复杂 JSON 用字符串字段：

```bash
actiondock plugin invoke actiondock-browser networkHeaders --session run1 \
  --headersJson '{"X-Test":"1"}' \
  --json
```

## Batch

多步流程可以放到 `batch --commands`，每行一条短命令：

```bash
actiondock plugin invoke actiondock-browser batch --session run1 \
  --commands $'open https://example.com\nsnapshot\nclick @e2\nwait url **/done' \
  --bail true \
  --json
```

## 兜底能力

常规动作不能满足时，用 `eval`：

```bash
actiondock plugin invoke actiondock-browser eval --session run1 \
  --expression '() => document.body.innerText' \
  --json

actiondock plugin invoke actiondock-browser eval --session run1 \
  --scope locator \
  --target @e1 \
  --expression 'el => el.outerHTML' \
  --json
```

## 排查顺序

1. 插件是否存在：`actiondock plugin get actiondock-browser`
2. action 参数是否匹配：`actiondock plugin action actiondock-browser <action>`
3. 会话是否存在：`sessionInfo` / `sessionList`
4. 页面是否变化：重新 `snapshot`
5. 元素 ref 是否过期：重新读取 `snapshot.elements`
6. 是否需要等待：补 `waitForLoad` / `waitForElement` / `waitForUrl` / `waitForResponse`
7. 是否触发弹窗、下载或新 tab：查看 `dialogList`、`networkEvents`、`tabList`
