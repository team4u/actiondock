# 本地联动调试与框架贡献指南

如果需要从源码参与 ActionDock 核心框架的开发，或者在外部业务项目中联合调试本地修改的 ActionDock 源码，请遵循以下开发与链接规范。

---

## 贡献者环境准备

参与 ActionDock 框架核心开发时，本地开发机需满足 Node.js >=24.12.0，推荐使用 npm 11 作为包管理器。日常开发、测试、构建与发布使用标准 npm 工作流。

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

进入命令行工具包目录，通过链接机制将本地开发版命令注册至系统路径：

```bash
cd packages/cli
npm link
```

完成链接后，全局执行 `ad` 将直接调用本地仓库中生成的最新产物。若后续修改了核心子包代码，需重新执行 `npm run build` 刷新编译产物。

---

## 在外部项目中调试本地 SDK

当在独立的 Action 业务项目中调试本地修改的 `@actiondock/sdk` 时，可执行依赖链接：

```bash
# 在 SDK 源码目录注册本地包链接
cd /path/to/actiondock/packages/sdk
npm link

# 在外部业务项目根目录链接该包
cd /path/to/my-action-project
npm link @actiondock/sdk
```

此时业务项目中的引用将直接解析至本地 SDK 源码目录，获得即时生效的调试体验。

---

## 依赖链接规范与原则

- 契约规范：业务项目的 `package.json` 中应始终显式声明规范版本范围（例如 `"@actiondock/sdk": "^2.2.0"`），严禁改写为本地物理路径，以确保团队协作与持续集成的一致性。
- 职责隔离：系统包管理器链接（`npm link`）用于解决本地开发态的代码寻址；ActionDock 内置的包注册机制（`ad link`）用于解决跨目录 Action 资产的定位与发现。两套机制职责独立，互不冲突。
