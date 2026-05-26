# 浏览器自动化

当用户需要打开网页、读取页面内容、点击元素、填写表单、处理弹窗/下载，或通过浏览器上下文发起请求时，使用 `actiondock-browser` 插件。

本文件只覆盖浏览器插件的常见场景。通用 `plugin` 命令、动态 flag、`--args-json` / `--args-file` 规则见 `references/plugin-usage.md`。

## 目标

用稳定、可观察的步骤完成浏览器任务：

1. 创建浏览器会话
2. 打开目标页面
3. 观察页面结构和可操作元素
4. 基于 `observe.elements[].ref` 操作页面
5. 页面变化后重新观察

## 标准工作流

```bash
actiondock plugin invoke actiondock-browser sessionCreate \
  --browser chromium \
  --headless true \
  --json

actiondock plugin invoke actiondock-browser goto \
  --sessionId <sessionId> \
  --url https://example.com \
  --json

actiondock plugin invoke actiondock-browser observe \
  --sessionId <sessionId> \
  --limit 80 \
  --json > /tmp/browser-observe.json
```

`observe` 返回页面摘要，重点看：

- `url` / `title`
- `visibleText`
- `ariaSnapshot`
- `elements[].ref`
- `forms`
- `frames`
- `events`
- `suggestions`

后续点击、填写、选择、截图元素时，优先使用 `observe.elements[].ref`：

```bash
actiondock plugin invoke actiondock-browser click \
  --sessionId <sessionId> \
  --args-json '{"target":{"ref":"e1"}}' \
  --json
```

## 参数约定

简单顶层字段优先直接写 flag：

```bash
actiondock plugin invoke actiondock-browser goto \
  --sessionId <sessionId> \
  --url https://example.com \
  --timeoutMs 30000 \
  --json
```

对象、数组或复杂字段使用 `--args-json` / `--args-file`：

```bash
actiondock plugin invoke actiondock-browser sessionCreate \
  --args-json '{"browser":"chromium","headless":true,"viewport":{"width":1280,"height":720}}' \
  --json
```

常见复杂字段包括：

- `target`
- `destination`
- `viewport`
- `geolocation`
- `headers`
- `cookies`
- `permissions`
- `args`
- `options`

如果不确定 action 参数，先看 schema：

```bash
actiondock plugin action actiondock-browser <action>
actiondock plugin invoke actiondock-browser capabilities --json
```

## 常见场景

### 读取网页内容

先用 `observe` 获取结构化摘要：

```bash
actiondock plugin invoke actiondock-browser observe \
  --sessionId <sessionId> \
  --limit 120 \
  --maxTextLength 12000 \
  --json > /tmp/browser-observe.json
```

需要完整 HTML 或正文文本时，用 `evaluate`：

```bash
actiondock plugin invoke actiondock-browser evaluate \
  --sessionId <sessionId> \
  --expression '() => document.documentElement.outerHTML' \
  --json > /tmp/page-html.json

actiondock plugin invoke actiondock-browser evaluate \
  --sessionId <sessionId> \
  --expression '() => document.body?.innerText || ""' \
  --json > /tmp/page-text.json
```

### 点击和基础元素操作

点击、悬停、聚焦、清空、滚动到元素等动作都优先使用 `target.ref`：

```bash
actiondock plugin invoke actiondock-browser click \
  --sessionId <sessionId> \
  --args-json '{"target":{"ref":"e2"}}' \
  --json

actiondock plugin invoke actiondock-browser scrollIntoView \
  --sessionId <sessionId> \
  --args-json '{"target":{"ref":"e8"}}' \
  --json
```

如果没有稳定 `ref`，可用选择器或语义定位，但要先确认 schema：

```bash
actiondock plugin invoke actiondock-browser click \
  --sessionId <sessionId> \
  --args-json '{"target":{"role":"button","name":"Submit","exact":true}}' \
  --json
```

### 填写表单

文本输入用 `fill` 或 `typeText`：

```bash
actiondock plugin invoke actiondock-browser fill \
  --sessionId <sessionId> \
  --value 'hello@example.com' \
  --args-json '{"target":{"ref":"e3"}}' \
  --json
```

选择框用 `selectOption`：

```bash
actiondock plugin invoke actiondock-browser selectOption \
  --sessionId <sessionId> \
  --value US \
  --args-json '{"target":{"ref":"e4"}}' \
  --json
```

复选框和单选框不要用 `fill`，使用 `setChecked` / `check` / `uncheck`：

```bash
actiondock plugin invoke actiondock-browser setChecked \
  --sessionId <sessionId> \
  --checked true \
  --args-json '{"target":{"ref":"e5"}}' \
  --json
```

文件上传用 `setInputFiles`，路径相对工作区：

```bash
actiondock plugin invoke actiondock-browser setInputFiles \
  --sessionId <sessionId> \
  --path ./upload.txt \
  --args-json '{"target":{"ref":"e6"}}' \
  --json
```

### 等待页面变化

页面跳转、按钮触发 DOM 变化、弹窗、下载或网络请求后，先等待，再重新 `observe`：

```bash
actiondock plugin invoke actiondock-browser waitForLoadState \
  --sessionId <sessionId> \
  --state load \
  --json

actiondock plugin invoke actiondock-browser observe \
  --sessionId <sessionId> \
  --limit 80 \
  --json > /tmp/browser-observe.json
```

常用等待动作：

| 场景 | 动作 |
|------|------|
| 页面加载 | `waitForLoadState` |
| 元素出现/消失 | `waitForSelector` |
| URL 变化 | `waitForUrl` |
| JS 条件满足 | `waitForFunction` |
| 请求/响应出现 | `waitForRequest` / `waitForResponse` |
| 控制台消息 | `waitForConsole` |
| 弹出新页面 | `waitForPopup` |
| 下载开始 | `waitForDownload` |

`target.ref` 只代表某次 `observe` 的结果。导航、弹窗、明显 DOM 更新后，必须重新 `observe`，再使用新的 `target.ref`。

### 多页面、弹窗和事件

读取 buffered 事件：

```bash
actiondock plugin invoke actiondock-browser events \
  --sessionId <sessionId> \
  --json > /tmp/browser-events.json
```

等待新页面并切换：

```bash
actiondock plugin invoke actiondock-browser waitForPopup \
  --sessionId <sessionId> \
  --json

actiondock plugin invoke actiondock-browser pageList \
  --sessionId <sessionId> \
  --json

actiondock plugin invoke actiondock-browser pageSwitch \
  --sessionId <sessionId> \
  --pageId <pageId> \
  --json
```

处理浏览器 dialog：

```bash
actiondock plugin invoke actiondock-browser dialogAccept \
  --sessionId <sessionId> \
  --dialogId <dialogId> \
  --json
```

`dialogId` 来自 `observe.events` 或 `events`。

### 下载和产物

等待下载并保存：

```bash
actiondock plugin invoke actiondock-browser waitForDownload \
  --sessionId <sessionId> \
  --json

actiondock plugin invoke actiondock-browser downloadSaveAs \
  --sessionId <sessionId> \
  --downloadId <downloadId> \
  --name report.csv \
  --json
```

截图或生成 PDF：

```bash
actiondock plugin invoke actiondock-browser screenshot \
  --sessionId <sessionId> \
  --name page \
  --fullPage true \
  --json

actiondock plugin invoke actiondock-browser locatorScreenshot \
  --sessionId <sessionId> \
  --name submit-button \
  --args-json '{"target":{"ref":"e7"}}' \
  --json

actiondock plugin invoke actiondock-browser pdf \
  --sessionId <sessionId> \
  --name page \
  --format A4 \
  --json
```

产物目录由插件配置控制，默认在浏览器 artifact/download 目录下。

### 登录态、Cookie 和网络

保存或复用登录态：

```bash
actiondock plugin invoke actiondock-browser storageState \
  --sessionId <sessionId> \
  --stateName login \
  --json

actiondock plugin invoke actiondock-browser sessionCreate \
  --browser chromium \
  --headless true \
  --stateName login \
  --json
```

读取、设置或清理 Cookie：

```bash
actiondock plugin invoke actiondock-browser cookiesGet \
  --sessionId <sessionId> \
  --json

actiondock plugin invoke actiondock-browser cookiesSet \
  --sessionId <sessionId> \
  --args-json '{"cookies":[{"name":"sid","value":"1","url":"https://example.com"}]}' \
  --json
```

使用浏览器上下文 Cookie 发起 HTTP 请求：

```bash
actiondock plugin invoke actiondock-browser httpRequest \
  --sessionId <sessionId> \
  --url https://example.com/api/me \
  --method GET \
  --json
```

网络拦截和离线模式：

```bash
actiondock plugin invoke actiondock-browser networkRoute \
  --sessionId <sessionId> \
  --url '**/*.png' \
  --routeAction abort \
  --json

actiondock plugin invoke actiondock-browser networkSetOffline \
  --sessionId <sessionId> \
  --offline true \
  --json
```

### 兜底能力

常规动作不能满足时，用 `evaluate` 执行页面 JS：

```bash
actiondock plugin invoke actiondock-browser evaluate \
  --sessionId <sessionId> \
  --scope page \
  --expression '() => window.location.href' \
  --json
```

需要调用较少用的 Playwright 操作时，用 `advancedAction`：

```bash
actiondock plugin invoke actiondock-browser advancedAction \
  --sessionId <sessionId> \
  --op click \
  --args-json '{"target":{"ref":"e1"},"options":{"button":"right"}}' \
  --json
```

`evaluate` 和 `advancedAction` 是逃生口。优先使用精确 action，只有现有 action 不够时再用。

## 会话管理

查看会话：

```bash
actiondock plugin invoke actiondock-browser sessionList --json
actiondock plugin invoke actiondock-browser sessionInfo --sessionId <sessionId> --json
```

任务结束后关闭会话：

```bash
actiondock plugin invoke actiondock-browser sessionClose \
  --sessionId <sessionId> \
  --json
```

## 排查顺序

1. 插件是否存在：`actiondock plugin get actiondock-browser`；如果命令返回插件不存在，再提示先安装 `actiondock-browser` 插件
2. action 参数是否匹配：`actiondock plugin action actiondock-browser <action>`
3. 会话是否仍有效：`sessionInfo` / `sessionList`
4. 页面状态是否变化：重新 `observe`
5. 元素 ref 是否过期：重新读取 `observe.elements`
6. 是否需要等待：补 `waitForLoadState` / `waitForSelector` / `waitForResponse`
7. 是否触发弹窗、下载或新页面：查看 `events`

## 术语

- `actiondock-browser`: 基于 Playwright 的浏览器插件，提供页面读取、操作、等待、事件、网络、截图和会话能力
- `sessionId`: 浏览器会话 ID，绝大多数 action 都需要传入
- `pageId`: 多页面/多 tab 场景下的页面 ID，不传时使用当前 active page
- `observe`: 页面观察动作，返回结构化摘要和可操作元素
- `target.ref`: `observe.elements[].ref` 中的临时元素引用，页面变化后需要重新获取
- `evaluate`: 在页面或元素上执行 JavaScript 的兜底动作
- `advancedAction`: 对少见 Playwright 操作的兜底动作
