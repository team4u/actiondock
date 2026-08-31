# 实践指南：独立二进制编译构建

ActionDock 2.0 的核心特性之一是将整个 Action Package 编译为**零外部依赖的单文件独立可执行文件**。

目标机器无需安装 Node.js、Bun、Python 或传输繁杂的 `node_modules` 文件夹，实现极致的开箱即用。

---

## 1. 执行编译

在项目根目录下执行 `ac build`：

```bash
ac build
```

控制台输出：
```text
[INFO] 开始编译独立可执行程序...
[INFO] 正在打包 TypeScript 依赖并内联 SQLite 引擎...
[SUCCESS] 独立可执行程序已构建: dist/bin/github-tools (大小: ~45MB)
```

---

## 2. 编译产物功能完整性

编译生成的独立二进制保留了开发态的全量功能（**Standalone Contract 独立编译契约**）：

```bash
# 1. 本地执行 Action
./dist/bin/github-tools run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'

# 2. 直接作为 MCP 服务端运行
./dist/bin/github-tools mcp

# 3. 运行内置 HTTP 微服务
./dist/bin/github-tools serve --port 8080

# 4. 管理持久化配置与状态
./dist/bin/github-tools config list
./dist/bin/github-tools state list
./dist/bin/github-tools runs list
```

---

## 3. 高级编译选项

| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `-o, --out <path>` | `./dist/bin/<name>` | 自定义输出可执行文件路径 |
| `--bytecode` | `false` | 启用 Bun 字节码预编译（加快冷启动，保护源码） |
| `--minify` | `false` | 压缩 JavaScript 代码与标识符，减小体积 |

示例：
```bash
ac build --out ./dist/my-tool --bytecode --minify
```

---

## 4. 交叉编译与部署

Bun 支持全平台交叉编译构建目标：
- `bun-linux-x64`
- `bun-linux-arm64`
- `bun-darwin-arm64`
- `bun-windows-x64`

生成的二进制文件可直接放入最小化 Docker 容器（如 `alpine` 或 `scratch`）或无公网受限沙箱中运行。
