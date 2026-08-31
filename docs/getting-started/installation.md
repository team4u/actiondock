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

### 贡献者 / 本地开发模式
如果您在开发 ActionDock 框架本身，可以在 Monorepo 根目录下软链接 CLI：
```bash
git clone https://github.com/team4u/actiondock.git
cd actiondock
bun install
cd packages/cli
bun link
```

---

## 3. 独立二进制运行（目标环境免安装）

请注意：**只有在开发和构建 Action Package 时才需要安装 Bun 与 ActionDock CLI**。

一旦您通过 `ac build` 将 Action Package 编译为独立二进制（如 `./dist/bin/my-tools`），该二进制是完全自包含、零外部依赖的单个可执行文件。在部署目标机器、Docker 最小镜像或 CI 沙箱中，**无需安装 Bun、Node.js 或任何依赖库**，直接运行即可。
