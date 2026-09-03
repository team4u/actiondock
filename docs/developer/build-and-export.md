# 构建、打包与 Skill 导出

ActionDock 2.0 提供了两大核心交付工具：
- `ac build`：编译为零外部依赖的单个独立可执行文件（适用于生产部署、CI/CD、容器）。
- `ac export skill`：打包为自包含的 Agent Skill 规范目录（适用于向 Claude Code、Antigravity、Codex 智能体分发）。

---

## 编译为零依赖独立二进制 (`ac build`)

在项目根目录下或使用 `-P <package-id>` 跨目录执行 `ac build`：

```bash
# 本地项目构建
ac build

# 跨目录构建指定的 linked package
ac build -P team4u.github-tools
```

控制台输出：
```text
[INFO] 开始编译独立可执行程序...
[INFO] 正在打包 TypeScript 依赖并内联 SQLite 引擎...
[SUCCESS] 独立可执行程序已构建: dist/bin/github-tools (大小: ~45MB)
```

### 独立编译契约
编译生成的独立二进制保留了开发态的全量功能，且行为完全一致：
```bash
# 直接本地调用 Action
./dist/bin/github-tools run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'

# 直接作为 MCP 服务端运行
./dist/bin/github-tools mcp

# 运行内置 HTTP 微服务
./dist/bin/github-tools serve --port 8080

# 管理持久化配置与状态
./dist/bin/github-tools config list
./dist/bin/github-tools state list
```

### 编译选项参数

| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `-P, --package <id>` | 当前项目 | 目标 Package ID 或路径（支持跨目录构建） |
| `-t, --target <target>` | 当前宿主平台 (`bun`) | 目标平台与 CPU 架构，支持全平台交叉编译 |
| `-o, --out <path>` | `./dist/bin/<name>` | 自定义输出可执行文件路径 |
| `-a, --actions <actions...>` | 全部 Action | 仅将指定的 Action 打包进独立二进制 |
| `--bytecode` | `true` | 启用 Bun 字节码预编译（加快冷启动，保护源码；可通过 `--no-bytecode` 关闭） |
| `--minify` | `true` | 压缩 JavaScript 代码与标识符，减小体积（可通过 `--no-minify` 关闭） |

### 全平台跨平台交叉编译 (`--target`)

ActionDock 支持在单台构建机（如 Linux CI 或 macOS 开发机）上直接为 Windows、macOS 与 Linux 生成目标平台的单文件独立可执行程序：

```bash
# 为 Linux x86_64 服务器构建
ac build -t linux-x64 -o ./dist/bin/github-tools-linux

# 为 Linux ARM64 (如 AWS Graviton / 树莓派) 构建
ac build -t linux-arm64 -o ./dist/bin/github-tools-linux-arm64

# 为 macOS Apple Silicon (M 系列芯片) 构建
ac build -t darwin-arm64 -o ./dist/bin/github-tools-macos-arm64

# 为 macOS Intel x86_64 构建
ac build -t darwin-x64 -o ./dist/bin/github-tools-macos-x64

# 为 Windows 平台构建（自动追加 .exe 扩展名）
ac build -t windows-x64 -o ./dist/bin/github-tools-windows
```

---

## 导出为 Agent Skill (`ac export skill`)

`ac export skill` 用于将 Action Package 打包为可供 AI 智能体直接理解与调用的自包含 Skill（支持 `-P` 跨目录导出）。

### 导出源码型 Skill（默认）
```bash
ac export skill
ac export skill -P team4u.github-tools
```
产物生成在 `./dist/<package-id>-skill/`：
- `SKILL.md`：包含 YAML Frontmatter 元数据与工具说明书。
- `actiondock.skill.json`：机器可读的 Tool Schema 清单。
- `actions/`：TypeScript Action 源码文件。
- `playbooks/`：SOP 操作规程 Markdown 文件。

### 导出独立二进制型 Skill
如果使用者的目标机器没有安装 Bun / Node.js：
```bash
ac export skill --standalone
```
此时导出包内包含预编译好的单文件二进制（在 `./bin/` 下），Agent 读取 `SKILL.md` 后直接调用 `./bin/<name> run <action>`，使用者零环境依赖。

### 按 Playbook 规程按需裁剪
当工具包很大，但特定任务只需要部分 Action 时，使用 `--playbook` 按需精简打包：
```bash
ac export skill --playbook review-pr --out ./dist/review-pr-skill
```
引擎会自动提取 `playbooks/review-pr.md` 引用的 Action 及其级联依赖，剔除无用文件。

---

## 分发与发布流程

开发者将构建产物分发给使用者的典型途径：

- **推送到 Git / 代码仓库**：使用者直接通过 `git clone` 拉取源码并在本地消费。
- **发布为 GitHub Release 资产**：将 `ac build` 生成的可执行文件或 `ac export skill` 生成的 Skill 压缩包挂载在 Release 资产中。
- **推送到 Skill 注册表 / S3**：供内部团队集中拉取。

> **提示**：关于使用者拿到 Skill 后如何配置到 Claude Code 或 Cursor，请参考 [使用者指南：Agent Skill 使用指南](../consumer/use-as-skill.md)。
