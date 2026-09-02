# 安装与环境准备

ActionDock 2.0 构建于原生 TypeScript 与 [Bun](https://bun.sh/) 运行时之上。

---

## 安装 Bun 运行时

ActionDock CLI 和核心编译器需要 Bun >= 1.2.0 环境。

```bash
npm install -g bun
```

### 验证安装
```bash
bun --version
# 输出类似: 1.2.0 或更高版本
```

---

## 安装 ActionDock CLI (`ac`)

### 全局安装
```bash
npm install -g @actiondock/cli
```

### 验证 CLI
```bash
ac --version
ac --help
```

### 贡献者 / 源码本地开发模式

如果您直接通过 Git 仓库源码使用或开发 ActionDock，只需使用 Bun 原生的 `bun link` 机制。

#### 链接 CLI 命令行工具与 SDK
```bash
git clone https://github.com/team4u/actiondock.git
cd actiondock
bun install

# 注册全局 ac 命令行工具
cd packages/cli
bun link

# 注册全局 @actiondock/sdk 依赖
cd ../sdk
bun link
```

#### 在外部 Action 项目中引用本地 SDK
当您使用 `ac init my-action` 创建独立项目后，在项目目录下执行：
```bash
cd /path/to/my-action

# SDK 已发布 npm 时：
bun install

# SDK 未发布 npm 时（404 即此情况）：
bun link @actiondock/sdk
```
此时项目中的 `import { defineAction } from "@actiondock/sdk"` 将直接指向本地 SDK 源码，享受即时热更新与毫秒级 TypeScript 原生类型推导。

*(注：如果是在 ActionDock Monorepo 的 `examples/` 目录下开发示例，Bun Workspaces 会自动解析 `@actiondock/sdk: "^2.0.0"`，无需手动 link。)*

---

## 依赖安装故障排查与 Link 原则

### 常见故障速查表

| 症状 / 报错 | 根本原因 | 解决办法 |
| :--- | :--- | :--- |
| `GET .../@actiondock%2fsdk - 404` | SDK 尚未发布至 npm | 在 SDK 源码目录执行 `bun link`，随后在项目内执行 `bun link @actiondock/sdk` |
| `SELF_SIGNED_CERT_IN_CHAIN` | 公司内网代理或自签 CA 证书 | 临时加前缀 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或配置 `bun config set cafile <CA路径>` |
| 清理 `node_modules` 后再次 404 | link 依赖不会写入 `bun.lock` | 项目内重新执行 `bun link @actiondock/sdk` 恢复链接 |

### Link 原则（开发者与 Agent 必读）

- **契约原则**：`package.json` 永远声明 `"@actiondock/sdk": "^2.0.0"`，**严禁**改为 `link:` 或本地相对路径（保证跨机器与独立构建一致性）。
- **分层原则**：SDK 源码根目录 `bun link` 全局执行一次；各 Action 项目内 `bun link @actiondock/sdk` 每项目执行一次。
- **双 Link 区分**：`ac link` 是 **ActionDock 全局包注册**（支持跨目录 `ac run pkg/action`），`bun link` 是 **TypeScript/Node 依赖解析**，两者职责独立，开发态通常都需要执行。

---

## 独立二进制运行（目标环境免安装）

请注意：**只有在开发和构建 Action Package 时才需要安装 Bun 与 ActionDock CLI**。

一旦您通过 `ac build` 将 Action Package 编译为独立二进制（如 `./dist/bin/my-tools`），该二进制是完全自包含、零外部依赖的单个可执行文件。在部署目标机器、Docker 最小镜像或 CI 沙箱中，**无需安装 Bun、Node.js 或任何依赖库**，直接运行即可。

