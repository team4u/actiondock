# 安装与环境准备

ActionDock 2.0 基础运行环境全面升级为 Node.js >=24.12.0，基于原生类型擦除、内置 SQLite 与原生 HTTP，支持 npm、pnpm、yarn 等标准包管理工具。

---

## 基础运行环境准备

ActionDock 核心工具链与运行时需要 Node.js >=24.12.0 环境，以利用其原生类型擦除、内置 SQLite 驱动与标准流式处理能力。

### 验证 Node.js 环境
在终端执行以下命令确认运行环境版本：
```bash
node --version
# 输出需满足 v24.12.0 或更高版本
```

---

## 全局安装 ActionDock 命令行工具

通过标准包管理工具全局安装 [@actiondock/cli](file:///root/code/action-dock/packages/cli/README.md) 门面工具包。该包将向操作系统注册全局命令 `ad` 与别名 `actiondock`。

### 全局安装方式
使用 npm 进行全局安装：
```bash
npm install -g @actiondock/cli
```

若使用其他包管理工具，可执行对应安装命令：
```bash
# 使用 pnpm 全局安装
pnpm add -g @actiondock/cli

# 使用 yarn 全局安装
yarn global add @actiondock/cli
```

### 验证安装结果
安装完成后，在终端中校验命令可用性与帮助信息：
```bash
ad --version
ad --help
```

---

## 依赖管理与锁定文件

ActionDock 2.0 采用标准的包依赖管理与锁定机制，无需安装任何外部专用编译器：

- 依赖锁定：通过 [actiondock.lock.json](file:///root/code/action-dock/packages/core/src/project/lockfile.ts)（规范版本 lockfileVersion: 1）严格锁定依赖树版本与完整性散列。
- 原子事务保护：使用 `ad add` 与 `ad remove` 命令安装或卸载依赖时，框架自动创建磁盘快照，在安装失败时自动回滚，杜绝依赖配置损坏。
- 交付产物构建：使用 `ad build` 命令将项目构建为自包含的 Node.js 目录交付产物，或使用 `ad pack` 打包为标准 npm tarball。

---

## 贡献者本地开发模式与多包链接规范

如果您需要从源码参与 ActionDock 核心框架的开发，或者在外部项目中联合调试本地修改的 ActionDock 源码，请遵循以下开发规范。

### 贡献者开发环境准备
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

### 注册本地全局命令行工具
进入命令行工具包目录，通过链接机制将本地开发版命令注册至系统路径：
```bash
cd packages/cli
npm link
```
完成链接后，全局执行 `ad` 将直接调用本地仓库中生成的最新产物。若后续修改了核心子包代码，需重新执行 `npm run build` 刷新编译产物。

### 在外部项目中链接本地 SDK
当在独立的 Action 业务项目中调试本地修改的 [@actiondock/sdk](file:///root/code/action-dock/packages/sdk/README.md) 时，可执行依赖链接：
```bash
# 在 SDK 源码目录注册本地包链接
cd /path/to/actiondock/packages/sdk
npm link

# 在外部业务项目根目录链接该包
cd /path/to/my-action-project
npm link @actiondock/sdk
```

此时业务项目中的引用将直接解析至本地 SDK 源码目录，获得即时生效的调试体验。

### 依赖链接规范与原则

- 契约规范：业务项目的 `package.json` 中应始终显式声明规范版本范围（例如 `"@actiondock/sdk": "^2.0.0"`），严禁改写为本地物理路径或本地相对路径，以确保团队协作与持续集成的一致性。
- 职责隔离：系统包管理器链接用于解决本地开发态的代码寻址；ActionDock 内置的包注册机制（`ad link`）用于解决跨目录 Action 资产的定位与发现。两套机制职责独立，互不冲突。
