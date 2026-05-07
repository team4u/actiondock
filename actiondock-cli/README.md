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
actiondock event-source repository-list
actiondock event-source repository-get demo-repo github-webhook
actiondock event-source repository-install demo-repo github-webhook
actiondock event-source repository-develop demo-repo github-webhook --source-id github-webhook-dev
actiondock event-source development-status github-webhook-dev
```

If the service requires auth, store a token:

```bash
actiondock config set token your-token
actiondock config show
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
```
