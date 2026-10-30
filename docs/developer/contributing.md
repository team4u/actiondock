# 本地联动调试与框架贡献指南

从源码参与 ActionDock 核心开发，或在外部项目中联合调试源码时，请遵循以下规范。

---

## 贡献者环境准备

开发机需安装 Node.js >=24.12.0。推荐使用 npm 11 作为包管理器。
日常开发、测试、构建与发布使用标准 npm 工作流。

### 克隆仓库与依赖安装

克隆官方代码仓库并安装 Monorepo 工作区依赖：

```bash
git clone https://github.com/team4u/actiondock.git
cd actiondock
npm install
```

### 常用验证与构建命令

- 执行全量单元测试与集成测试：
  ```bash
  npm test
  ```
- 执行全量 TypeScript 类型检查：
  ```bash
  npm run typecheck
  ```
- 执行多包产物全量构建：
  ```bash
  npm run build
  ```
- 执行发布打包冒烟测试：
  ```bash
  npm run test:pack
  ```

---

## 注册本地全局命令行工具

进入命令行包目录，通过链接机制将本地开发版命令注册至系统路径：

```bash
cd packages/cli
npm link
```

完成链接后，全局执行 `ad` 将调用本地生成的最新产物。
修改核心子包代码后，需重新执行 `npm run build` 刷新产物。

---

## 在外部项目中调试本地 SDK

在独立业务项目中调试修改后的 `@actiondock/sdk` 时，可执行依赖链接：

```bash
# 在 SDK 源码目录注册本地包链接
cd /path/to/actiondock/packages/sdk
npm link

# 在外部业务项目根目录链接该包
cd /path/to/my-action-project
npm link @actiondock/sdk
```

业务项目的引用将直接解析至本地 SDK 源码目录，代码修改即时生效。

---

## 依赖链接规范与原则

- 契约规范：业务项目在 `package.json` 中声明规范版本范围（例如 `"@actiondock/sdk": "^2.3.0"`）。严禁改写为本地物理路径，以保持团队协作一致。
- 职责隔离：系统包链接（`npm link`）解决开发态代码寻址。内置注册机制（`ad link`）定位跨目录 Action 资产。两套机制职责独立，互不冲突。
