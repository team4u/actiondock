# actiondock-cli

## 常用命令

以下命令对应当前“工作副本 + 上游绑定”模型，不再使用旧的 `development-*` 命名。

### 从仓库资源创建工作副本

仓库脚本 -> 脚本工作副本：

```bash
actiondock script repository-working-copy <repositoryId> <scriptId>
actiondock script repository-working-copy <repositoryId> <scriptId> --script-id <localScriptId>
```

仓库 Webhook -> Webhook 工作副本：

```bash
actiondock webhook repository-working-copy <repositoryId> <webhookId>
actiondock webhook repository-working-copy <repositoryId> <webhookId> --webhook-id <localWebhookId>
```

### 查看上游同步状态

脚本工作副本：

```bash
actiondock script upstream-status <scriptId>
```

Webhook 工作副本：

```bash
actiondock webhook upstream-status <webhookId>
```

### 从上游拉取更新

脚本工作副本：

```bash
actiondock script upstream-pull <scriptId>
actiondock script upstream-pull <scriptId> --force
```

Webhook 工作副本：

```bash
actiondock webhook upstream-pull <webhookId>
actiondock webhook upstream-pull <webhookId> --force
```

### 说明

- 工作副本在本地以普通可编辑资源存在。
- 上游同步关系由 `upstream binding` 维护。
- `--force` 会在存在本地改动时强制用上游内容覆盖当前工作副本。

## 项目仓库解析

如果要读取某个业务项目的知识库入口，使用：

```bash
actiondock repository list --purpose project
actiondock repository sync <repositoryId>
actiondock repository resolve --repository-id <repositoryId>
actiondock repository resolve --repository-id <repositoryId> --json
```

约定上，项目仓库会在项目根目录放一个 `ACTIONDOCK.md`。CLI 会返回：

- 项目根目录
- 入口文件路径
- `ACTIONDOCK.md` 的原始 Markdown 内容

后续再根据正文去读取 `overview.md`、`database.md`、`workflows.md`、`runbooks/` 或源码。

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
npm view actiondock
npm install -g actiondock@latest
actiondock --help
actiondock server
```
