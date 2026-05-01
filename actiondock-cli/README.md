# @actiondock/cli

ActionDock 的命令行客户端，用来把现有 JSON REST API 包装成更适合终端和 AI 调用的扁平命令参数。

它的核心目标不是替代 API，而是降低命令调用成本：能直接写成 `--name alice --message hello` 的字段就不要再手写整段 JSON；只有对象、数组这类复杂结构才回退到 `--input-json`、`--args-json` 或 `--script-input-json`。

## 适用场景

- 需要从终端直接调用 ActionDock，不想手写 `curl` 和 JSON body
- 需要给 AI 代理稳定地下发命令，尽量减少转义、换行和双引号问题
- 需要把执行结果转成机器可读 JSON，便于后续脚本处理

## 安装

要求 Node.js 18 或更高版本。

```bash
npm install -g @actiondock/cli
actiondock --help
```

安装后可执行文件名仍然是 `actiondock`。

CLI 会异步检查 npm 上是否有新版本；这不会阻塞当前命令，但提示通常会出现在后一次运行里。升级时直接执行：

```bash
npm install -g @actiondock/cli@latest
actiondock self-update
```

如果你不想看到版本提示，可以临时关闭：

```bash
ACTIONDOCK_SKIP_NEW_VERSION_CHECK=1 actiondock --help
```

如果你只想看 CLI 将执行什么升级命令，可以先 dry run：

```bash
actiondock self-update --dry-run
actiondock self-update 0.1.4 --dry-run
```

## 快速开始

如果你的 ActionDock 服务运行在本机，CLI 默认会连接 `http://127.0.0.1:5177`，不需要显式传 `--server`。

```bash
actiondock script list
actiondock script schema hello-world
actiondock script run hello-world --message hello --name alice --json
```

如果服务要求鉴权，先保存 token：

```bash
actiondock config set token your-token
actiondock config show
```

默认执行已发布版本；如果需要切到草稿版本，再显式加 `--draft`。

## 常用命令

### Script

```bash
actiondock script create --script-id hello-world --name "Hello World" --type groovy --source-file ./hello.groovy --input-schema-file ./input.schema.json --output-schema-file ./output.schema.json --json
actiondock script create --script-id hello-python --name "Hello Python" --type python --source-file ./hello.py --input-schema-file ./input.schema.json --output-schema-file ./output.schema.json --json
actiondock script get hello-world --json
actiondock script patch hello-world --source-file ./hello.v2.groovy --json
actiondock script patch hello-world --patch-json '{"inputSchema":{"properties":{"name":{"type":"string"}}}}' --json
actiondock script validate hello-world --json
actiondock script publish hello-world --json
actiondock script discard-draft hello-world --json
```

### Script Invocation

```bash
actiondock script list
actiondock script get hello-world --json
actiondock script schema hello-world
actiondock script run hello-world --message hello --name alice --count 3 --json
actiondock script run hello-world --message hello --draft --json
```

### Execution

```bash
actiondock execution get exec-1 --json
actiondock execution list --script-id hello-world --json
actiondock execution list --schedule-id schedule-1 --json
actiondock execution delete exec-1 --json
actiondock execution clear --script-id hello-world --json
```

`execution list` 至少需要提供 `--script-id` 或 `--schedule-id` 之一。

### Schedule

```bash
actiondock schedule list --json
actiondock schedule list --script-id hello-world --json
actiondock schedule get schedule-1 --json
actiondock schedule create --script-id hello-world --schedule-name hourly-sync --schedule-cron "0 */5 * * * *" --message hello --name alice --json
actiondock schedule update schedule-1 --schedule-name nightly-sync --count 3 --json
actiondock schedule enable schedule-1 --json
actiondock schedule disable schedule-1 --json
actiondock schedule delete schedule-1 --json
```

### Event Source

```bash
actiondock event-source list --json
actiondock event-source get source-1 --json
actiondock event-source create --definition-file ./event-source.json --json
actiondock event-source update source-1 --definition-json '{"auth":{"secretConfigKey":"github.webhook.secret"}}' --json
actiondock event-source enable source-1 --json
actiondock event-source disable source-1 --json
actiondock event-source test-normalization source-1 --payload-file ./incoming-event.json --json
actiondock event-source ingest source-1 --payload-file ./incoming-event.json --json
actiondock event-source events source-1 --limit 20 --json
actiondock event-source delete source-1 --json
```

### Event Trigger

```bash
actiondock event-trigger list --json
actiondock event-trigger get trigger-1 --json
actiondock event-trigger create --definition-file ./event-trigger.json --json
actiondock event-trigger update trigger-1 --definition-json '{"submitMode":"SYNC"}' --json
actiondock event-trigger enable trigger-1 --json
actiondock event-trigger disable trigger-1 --json
actiondock event-trigger test trigger-1 --event-file ./normalized-event.json --execute --json
actiondock event-trigger dispatches trigger-1 --json
actiondock event-trigger delete trigger-1 --json
```

### Event Record

```bash
actiondock event-record list --json
actiondock event-record list --source-id source-1 --json
actiondock event-record get event-1 --json
actiondock event-record dispatches event-1 --json
```

### Processor

```bash
actiondock processor test --processor-file ./processor.json --context-file ./processor-context.json --json
actiondock processor test --processor-json '{"mode":"JSON_PATH","jsonPath":{"fields":{"title":"$.body.issue.title"}}}' --context-json '{"body":{"issue":{"title":"Login failed"}}}' --json
```

### Plugin

```bash
actiondock plugin list --json
actiondock plugin get my-plugin --json
actiondock plugin references --json
actiondock plugin install ./target/my-plugin-1.0.0.jar --json
actiondock plugin config get my-plugin --json
actiondock plugin invoke my-plugin hello --name world
actiondock plugin invoke my-plugin summarize --topic ops --priority 3 --script-input-json '{"locale":"zh-CN"}'
```

### State

```bash
actiondock state namespaces --json
actiondock state list oauth.github --json
actiondock state get oauth.github access-token --json
actiondock state put oauth.github access-token --value-json '{"accessToken":"gho_xxx"}' --secret --json
actiondock state cas cursor.sync users --expected-version 3 --value-json '{"cursor":"next-page-token"}' --json
actiondock state delete oauth.github access-token --json
actiondock state purge-expired oauth.github --json
```

## 复杂参数与 JSON 输入

CLI 会优先把顶层字符串、数字和布尔字段展开成普通 flags。例如：

```bash
actiondock script run hello-world --message hello --count 3 --json
actiondock plugin invoke my-plugin summarize --topic ops --limit 5
```

如果某个布尔字段存在，也可以直接写成无值 flag，例如 `--enabled`。

当字段本身是对象或数组时，改用 JSON 或文件输入：

```bash
actiondock script run hello-world --input-json '{"name":"alice","payload":{"x":1,"tags":["a","b"]}}' --json
actiondock script run hello-world --input-file ./examples/hello-world.json --json
actiondock schedule create --script-id hello-world --schedule-name hourly-sync --schedule-cron "0 */5 * * * *" --input-json '{"payload":{"source":"file"}}' --name alice --json
actiondock schedule update schedule-1 --replace-input --input-file ./examples/schedule-input.json --schedule-disabled --json
actiondock plugin invoke my-plugin summarize --args-json '{"topic":"ops","filters":{"env":"prod"}}'
actiondock plugin invoke my-plugin summarize --args-file ./examples/plugin-args.json --script-input-file ./examples/script-input.json
actiondock event-source create --definition-file ./event-source.json --json
actiondock event-source ingest source-1 --payload-file ./incoming-event.json --json
actiondock event-trigger test trigger-1 --event-file ./normalized-event.json --json
actiondock processor test --processor-file ./processor.json --context-file ./processor-context.json --json
```

PowerShell 也建议保持单行调用，避免多行反引号和额外转义：

```powershell
actiondock script run hello-world --input-json '{"name":"alice","payload":{"x":1}}' --json
```

如果需要更多执行细节，可显式传 `--response-view debug`。

## 推荐给 AI 的闭环

如果你是让外部大模型持续创建和调试脚本，建议整个闭环都只使用 `script` 命令，避免混入旧术语。

一个最稳定的循环通常是：

```bash
actiondock script create --script-id hello-world --name "Hello World" --type groovy --source-file ./hello.groovy --json
actiondock script patch hello-world --source-file ./hello.v2.groovy --json
actiondock script validate hello-world --json
actiondock script run hello-world --draft --input-json '{"name":"alice"}' --response-view debug --json
actiondock execution get exec-1 --json
actiondock script publish hello-world --json
```

Python 脚本的闭环也是同一组命令，只是把 `--type` 和源码文件换成 Python：

```bash
actiondock script create --script-id hello-python --name "Hello Python" --type python --source-file ./hello.py --json
actiondock script patch hello-python --source-file ./hello.v2.py --json
actiondock script validate hello-python --json
actiondock script run hello-python --draft --input-json '{"name":"alice"}' --response-view debug --json
actiondock script publish hello-python --json
```

`script patch` 会调用服务端的 `PATCH /api/scripts/{id}`，只允许更新 `source`、`inputSchema`、`outputSchema`，避免模型在调试时误覆盖脚本元数据。

## 事件框架闭环

如果你希望 AI 通过 CLI 直接创建整套事件接入链路，建议按下面的顺序执行：

```bash
actiondock script create --script-id processor-github-issue --name "GitHub Issue Processor" --type python --source-file ./processor.py --input-schema-file ./processor-input-schema.json --output-schema-file ./processor-output-schema.json --json
actiondock script publish processor-github-issue --json

actiondock event-source create --definition-file ./event-source.github-issue.json --json
actiondock event-source test-normalization source-github-issue --payload-file ./github-event.raw.json --json

actiondock event-trigger create --definition-file ./event-trigger.github-issue.json --json
actiondock event-trigger test trigger-github-issue --event-file ./github-event.normalized.json --json

actiondock event-source ingest source-github-issue --payload-file ./github-event.raw.json --json
actiondock event-record list --source-id source-github-issue --json
actiondock event-record dispatches event-1 --json
```

推荐把复杂事件定义都放进文件，而不是内联大段 JSON。对 AI 来说，这样更稳定，也更适合反复 patch。

典型文件拆分如下：

```text
./processor.py
./processor-input-schema.json
./processor-output-schema.json
./event-source.github-issue.json
./event-trigger.github-issue.json
./github-event.raw.json
./github-event.normalized.json
```

其中：

- `event-source ... create|update` 用完整定义对象
- `event-trigger ... create|update` 用完整定义对象
- `event-source test-normalization|ingest` 用原始 webhook payload
- `event-trigger test` 用标准化后的 `NormalizedEvent`
- `processor test` 用 `ProcessorDefinition + ProcessorContext`

更新命令会先拉取当前对象，再把 `--definition-json` 或 `--definition-file` 深度合并回去，然后执行 `PUT`。这样 AI 只改局部字段时，不会把嵌套配置整体清空。

## 配置与默认值

### 本地配置

```bash
actiondock config set server http://127.0.0.1:5177
actiondock config set token your-token
actiondock config show
actiondock config clear token
```

### 环境变量

- `ACTIONDOCK_BASE_URL`
- `ACTIONDOCK_TOKEN`

### 优先级

命令参数 > 环境变量 > 本地配置 > 默认值

默认服务地址是 `http://127.0.0.1:5177`。`script run` 默认同步执行，不需要额外指定同步模式。

## 自动补全

CLI 集成了 `@oclif/plugin-autocomplete`。安装完成后执行：

```bash
actiondock autocomplete
```

按提示为当前 shell 安装补全脚本即可。新增子命令和 flags 后，会自动进入补全体系。

如果升级 CLI 后，新命令没有立刻出现在补全里，先刷新补全缓存，再重新加载当前 shell：

```bash
actiondock autocomplete --refresh-cache
exec zsh
```

PowerShell 对应的是：

```powershell
actiondock autocomplete --refresh-cache
. $PROFILE
```

如果当前 PowerShell 会话还没安装过补全脚本，先执行：

```powershell
New-Item -Type Directory -Path (Split-Path -Parent $PROFILE) -ErrorAction SilentlyContinue
Add-Content -Path $PROFILE -Value (Invoke-Expression -Command "actiondock autocomplete script powershell")
. $PROFILE
```

## 开发与发布

如果你是在仓库内维护这个子项目，最常用的命令只有下面几条：

```bash
npm install
npm run dev -- script list
npm run build
npm test
```

发布前至少检查一次构建和测试是否通过。
