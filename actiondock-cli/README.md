# actiondock-cli


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
