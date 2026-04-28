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
actiondock tool list
actiondock tool schema hello-world
actiondock tool run hello-world --message hello --name alice --json
```

如果服务要求鉴权，先保存 token：

```bash
actiondock config set token your-token
actiondock config show
```

默认执行已发布版本；如果需要切到草稿版本，再显式加 `--draft`。

## 常用命令

### Tool

```bash
actiondock tool list
actiondock tool get hello-world --json
actiondock tool schema hello-world
actiondock tool run hello-world --message hello --name alice --count 3 --json
actiondock tool run hello-world --message hello --draft --json
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
actiondock tool run hello-world --message hello --count 3 --json
actiondock plugin invoke my-plugin summarize --topic ops --limit 5
```

如果某个布尔字段存在，也可以直接写成无值 flag，例如 `--enabled`。

当字段本身是对象或数组时，改用 JSON 或文件输入：

```bash
actiondock tool run hello-world --input-json '{"name":"alice","payload":{"x":1,"tags":["a","b"]}}' --json
actiondock tool run hello-world --input-file ./examples/hello-world.json --json
actiondock schedule create --script-id hello-world --schedule-name hourly-sync --schedule-cron "0 */5 * * * *" --input-json '{"payload":{"source":"file"}}' --name alice --json
actiondock schedule update schedule-1 --replace-input --input-file ./examples/schedule-input.json --schedule-disabled --json
actiondock plugin invoke my-plugin summarize --args-json '{"topic":"ops","filters":{"env":"prod"}}'
actiondock plugin invoke my-plugin summarize --args-file ./examples/plugin-args.json --script-input-file ./examples/script-input.json
```

PowerShell 也建议保持单行调用，避免多行反引号和额外转义：

```powershell
actiondock tool run hello-world --input-json '{"name":"alice","payload":{"x":1}}' --json
```

如果需要更多执行细节，可显式传 `--response-view debug`。

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

默认服务地址是 `http://127.0.0.1:5177`。`tool run` 默认同步执行，不需要额外指定同步模式。

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
npm run dev -- tool list
npm run build
npm test
```

发布前至少检查一次构建和测试是否通过。
