# actiondock

This directory contains the npm package published as `actiondock`.

The package provides the existing oclif CLI plus the local Java/Spring runtime,
desktop tray launcher, and user-level service management. End users install one
package and use one public command:

```bash
npm install -g actiondock
actiondock --help
```

## Runtime Commands

```bash
actiondock desktop
actiondock server
actiondock service install
actiondock service start
actiondock service status
actiondock service stop
actiondock service uninstall
```

`actiondock desktop` starts or reuses the local runtime, opens the admin console,
and keeps a tray control surface alive. `actiondock server` runs the Spring
runtime in the foreground. `actiondock service ...` manages a user LaunchAgent
on macOS and a user systemd service on Linux.

The internal commands `actiondock-runtime` and `actiondock-desktop-runtime` are
implementation details used by the CLI bridge and are not public API.

## CLI Usage

If your ActionDock service runs locally, CLI commands default to
`http://127.0.0.1:5177`.

```bash
actiondock script list
actiondock script schema hello-world
actiondock script run hello-world --message hello --name alice --json
```

If the service requires auth, store a token:

```bash
actiondock config set token your-token
actiondock config show
```

### Scripts, presets, executions, and schedules

```bash
actiondock script create --script-id hello-world --name "Hello World" --source-file hello.groovy
actiondock script patch hello-world --patch-file patch.json
actiondock script validate hello-world
actiondock script publish hello-world
actiondock script run hello-world --message hello --json

actiondock script preset list hello-world
actiondock script preset create hello-world --name "Alice" --input-json '{"name":"Alice"}'
actiondock script preset update hello-world alice --name "Alice v2" --input-file input.json
actiondock script preset delete hello-world alice

actiondock execution list --script-id hello-world
actiondock execution get exec-1
actiondock execution delete exec-1
actiondock execution clear --script-id hello-world

actiondock schedule list --script-id hello-world
actiondock schedule create --script-id hello-world --schedule-name nightly --schedule-cron "0 0 * * * *"
actiondock schedule enable schedule-1
actiondock schedule disable schedule-1
actiondock schedule delete schedule-1
```

### Event automation

```bash
actiondock event-source list
actiondock event-source create --definition-file event-source.json
actiondock event-source update github-webhook --definition-file event-source.patch.json
actiondock event-source enable github-webhook
actiondock event-source test-normalization github-webhook --payload-file payload.json
actiondock event-source ingest github-webhook --payload-file payload.json
actiondock event-source events github-webhook --limit 20

actiondock event-trigger list
actiondock event-trigger create --definition-file trigger.json
actiondock event-trigger update trigger-1 --definition-json '{"submitMode":"SYNC"}'
actiondock event-trigger test trigger-1 --event-file event.json --execute
actiondock event-trigger dispatches trigger-1

actiondock event-record list --source-id github-webhook
actiondock event-record get event-1
actiondock event-record dispatches event-1
```

### Repositories and repository tools

```bash
actiondock repository list
actiondock repository create --repository-id demo-repo --name "Demo Repo" --type local-dir --url /path/to/repo --trust-level trusted
actiondock repository update demo-repo --name "Demo Repo" --type local-dir --url /path/to/repo --usage development
actiondock repository sync demo-repo
actiondock repository delete demo-repo

actiondock repository tool list
actiondock repository tool list --repository demo-repo
actiondock repository tool get demo-repo hello-world
actiondock repository tool install demo-repo hello-world --install-schedules --install-plugin-dependencies
actiondock repository tool update demo-repo hello-world
actiondock repository tool develop demo-repo hello-world --script-id hello-world-dev

actiondock event-source repository-list
actiondock event-source repository-get demo-repo github-webhook
actiondock event-source repository-install demo-repo github-webhook
actiondock event-source repository-develop demo-repo github-webhook --source-id github-webhook-dev
actiondock event-source development-status github-webhook-dev
```

### Plugins

```bash
actiondock plugin list
actiondock plugin references
actiondock plugin get plugin-a
actiondock plugin install plugin.jar
actiondock plugin upgrade plugin-a plugin.jar
actiondock plugin start plugin-a
actiondock plugin stop plugin-a
actiondock plugin download plugin-a --output ./plugins
actiondock plugin uninstall plugin-a --force

actiondock plugin config get plugin-a
actiondock plugin config set plugin-a --config-json '{"endpoint":"http://service.internal"}'
actiondock plugin invoke plugin-a summarize --topic ops --script-input-json '{"locale":"zh-CN"}'
```

### Config values, access tokens, and shared state

```bash
actiondock config-value list
actiondock config-value get github.token
actiondock config-value set github.token --value gho_xxx --secret --description "GitHub token"
actiondock config-value copy-local-override github.token
actiondock config-value restore-repository-default github.token
actiondock config-value delete github.token

actiondock access-token list
actiondock access-token create --name "CI"
actiondock access-token rename token-1 --name "Deploy"
actiondock access-token enable token-1
actiondock access-token disable token-1
actiondock access-token delete token-1

actiondock state namespaces
actiondock state list oauth.github
actiondock state put oauth.github access-token --secret --value-json '{"accessToken":"gho_xxx"}'
actiondock state cas cursor.sync users --expected-version 3 --value-json '{"cursor":"next-page"}'
actiondock state delete oauth.github access-token
actiondock state purge-expired oauth.github
```

Self-update uses the unified package name:

```bash
actiondock self-update --dry-run
actiondock self-update 0.1.2 --dry-run
```

## Local Development

```bash
npm install
npm run prepack
npm link
```

`prepack` compiles the TypeScript CLI, builds the Spring runtime jar, copies it
to `runtime/actiondock-app-spring.jar`, and generates `jdeploy-bundle/` for the
published package.

Check package contents before publishing:

```bash
npm run pack:dry-run
```

## 打包与发布流程

从仓库根目录进入本目录：

```bash
cd actiondock-cli
```

### 1. 准备环境

要求：

- Node.js 18+
- JDK 21
- Maven
- npm 已登录：`npm whoami`

安装依赖：

```bash
npm ci
```

### 2. 构建最终发布产物

```bash
npm run prepack
```

这个命令会依次执行：

- `npm run build`：编译 CLI 到 `dist/`
- `npm run build:runtime`：用 Maven 构建 Spring Boot runtime jar，并复制到 `runtime/actiondock-app-spring.jar`
- `npm run jdeploy:package`：生成 `jdeploy-bundle/`

### 3. 检查 npm 包内容

```bash
npm run pack:dry-run
```

必须确认输出里有：

```text
bin/**
dist/**
jdeploy-bundle/**
jdeploy-bundle/actiondock-app-spring.jar
jdeploy-bundle/jdeploy.cjs
package.json
README.md
```

不应该出现：

```text
src/**
test/**
node_modules/**
../actiondock-app-spring/target/**
../actiondock-admin-ui/node_modules/**
```

### 4. 发布到 npm

先确认 `package.json` 的 `version` 是要发布的版本。

推荐发布命令：

```bash
npm publish --access public --ignore-scripts
```

推荐加 `--ignore-scripts`，因为第 2 步已经显式执行过 `prepack`。不加这个参数时，`npm publish` 会再次自动执行 `prepack`，会重复构建 runtime 和 jDeploy bundle。

如果希望一条命令自动构建并发布，也可以执行：

```bash
npm publish --access public
```

### 5. 发布后验证

```bash
npm view actiondock name version
npm install -g actiondock@latest
actiondock --help
actiondock server
actiondock desktop
actiondock service status
```

### 6. 发布 GitHub/jDeploy 桌面安装包

GitHub Actions workflow `.github/workflows/jdeploy.yml` 会从本目录执行：

```bash
npm ci
npm run prepack
```

然后用 jDeploy 生成桌面安装包。

创建 GitHub Release：

```bash
gh release create v0.3.5 --target main --title "v0.3.5" --notes "ActionDock desktop release"
```

或者推送 tag：

```bash
git tag v0.3.5
git push origin v0.3.5
```

### 7. 不要发布旧包

不要再发布或文档化这些入口：

```text
@actiondock/cli
@actiondock/server
actiondock-server
actiondock capability *
```
