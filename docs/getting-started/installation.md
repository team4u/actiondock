# 安装与环境准备

ActionDock 2.0 基础运行环境全面基于 Node.js 22+ 与 24 LTS 构建，提供企业级长效支持与运行时稳定性，支持 npm、pnpm、yarn 等标准包管理工具。

---

## 基础运行环境准备

ActionDock 核心工具链与运行时需要 Node.js 22.0.0 或更高版本环境（推荐使用 22+ 或 24 LTS），以利用其原生内置的 SQLite 同步事务存储能力与标准 Web 流式处理引擎。

### 验证 Node.js 环境
在终端执行以下命令确认运行环境版本：
```bash
node --version
# 输出需满足 v22.0.0 或更高版本，例如 v22.12.0
```

---

## 全局安装 ActionDock 命令行工具

通过标准包管理工具全局安装 `@actiondock/cli` 门面工具包。该包将向操作系统注册全局命令 `ad` 与别名 `actiondock`。

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

## 独立二进制编译时的可选 Bun 编译器安装

在 ActionDock 架构中，请明确以下运行边界：

- **日常开发与消费完全无需 Bun**：编写 Action 逻辑、本地调试执行、运行单元测试、启动 MCP 服务、部署 HTTP 远程微服务，以及作为 Agent Skill 消费，均完全基于 Node.js 运行，无需在开发机或部署服务器上安装 Bun。
- **构建独立二进制的可选编译器**：仅当需要使用 `ad build` 命令将 Action Package 编译为单个零依赖的原生独立可执行二进制文件时，底层编译管线才需要调用 Bun 作为轻量打包编译引擎。

### 安装 Bun 编译器（仅构建独立二进制需要）
若需要执行独立二进制编译，可在开发机器上安装 Bun：
```bash
# 通过 npm 安装 Bun
npm install -g bun

# 验证编译器安装
bun --version
```

### 目标环境免依赖部署说明
由 `ad build` 编译生成的独立二进制程序为完全自包含的单一可执行文件。在目标生产服务器、精简容器镜像或 CI 沙箱中分发与运行该产物时，**无需安装 Node.js、无需安装 Bun，亦无需安装任何外部依赖包**，直接运行即可。

---

## 贡献者本地开发模式与多包链接规范

如果您需要从源码参与 ActionDock 核心框架的开发，或者在外部项目中联合调试本地修改的 ActionDock 源码，请遵循以下工作区链接规范。

### 克隆仓库与依赖安装
克隆官方代码仓库并安装 Monorepo 工作区依赖：
```bash
git clone https://github.com/team4u/actiondock.git
cd actiondock
npm install
```

### 注册本地全局命令行工具
进入命令行工具包目录，通过链接机制将本地开发版命令注册至系统路径：
```bash
cd packages/cli
npm link
```
完成链接后，全局执行 `ad` 将直接运行本地仓库中的最新源码。

### 在外部项目中链接本地 SDK
当在独立的 Action 业务项目中调试尚未发布至公共仓库的本地 `@actiondock/sdk` 修改时，可执行依赖链接：
```bash
# 在 SDK 源码目录注册本地包链接
cd /path/to/actiondock/packages/sdk
npm link

# 在外部业务项目根目录链接该包
cd /path/to/my-action-project
npm link @actiondock/sdk
```

此时业务项目中的 `import { defineAction } from "@actiondock/sdk"` 将直接解析至本地 SDK 源码目录，获得即时生效的调试体验。

### 依赖链接规范与原则

- **契约规范**：业务项目的 `package.json` 中应始终显式声明规范版本范围（例如 `"@actiondock/sdk": "^2.0.0"`），严禁改写为本地物理路径或本地相对路径，以确保团队协作、持续集成与独立构建产物的一致性。
- **职责隔离**：系统包管理器链接用于解决本地开发态的代码寻址；ActionDock 内置的包注册机制（`ad link`）用于解决跨目录 Action 资产的定位与发现。两套机制职责独立，互不冲突。
