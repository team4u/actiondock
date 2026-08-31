# 安装与环境准备

ActionDock 2.0 构建于原生 TypeScript 与 [Bun](https://bun.sh/) 运行时之上。

---

## 1. 安装 Bun 运行时

ActionDock CLI 和核心编译器需要 Bun 1.1+ 环境。

### macOS / Linux
```bash
curl -fsSL https://bun.sh/install | bash
```

### Windows (PowerShell)
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 验证安装
```bash
bun --version
# 输出类似: 1.1.0 或更高版本
```

---

## 2. 安装 ActionDock CLI (`ac`)

### 推荐：全局安装
```bash
bun install -g @actiondock/cli
```

### 验证 CLI
```bash
ac --version
ac --help
```

### 贡献者 / 源码本地开发模式（未发布到 npm 时）

如果您直接通过 Git 仓库源码使用或开发 ActionDock，只需使用 Bun 原生的 `bun link` 机制，无需发布到 npm：

#### 1. 链接 CLI 命令行工具与 SDK
```bash
git clone https://github.com/team4u/actiondock.git
cd actiondock
bun install

# 1. 注册全局 ac 命令行工具
cd packages/cli
bun link

# 2. 注册全局 @actiondock/sdk 依赖
cd ../sdk
bun link
```

#### 2. 在外部 Action 项目中引用本地 SDK
当您使用 `ac init my-action` 创建独立项目后，在项目目录下执行：
```bash
cd /path/to/my-action
bun link @actiondock/sdk
```
此时项目中的 `import { defineAction } from "@actiondock/sdk"` 将直接指向本地 SDK 源码，享受即时热更新与毫秒级 TypeScript 原生类型推导。

*(注：如果是在 ActionDock Monorepo 的 `examples/` 目录下开发示例，Bun Workspaces 会自动解析 `@actiondock/sdk: "workspace:*"`，无需手动 link。)*

---

## 3. 独立二进制运行（目标环境免安装）

请注意：**只有在开发和构建 Action Package 时才需要安装 Bun 与 ActionDock CLI**。

一旦您通过 `ac build` 将 Action Package 编译为独立二进制（如 `./dist/bin/my-tools`），该二进制是完全自包含、零外部依赖的单个可执行文件。在部署目标机器、Docker 最小镜像或 CI 沙箱中，**无需安装 Bun、Node.js 或任何依赖库**，直接运行即可。

