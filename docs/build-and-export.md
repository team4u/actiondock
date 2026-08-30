# 构建编译与 Skill 分发

ActionDock 2.0 的核心交付模型是**独立自包含二进制（Standalone Executable）**与**标准 Agent Skill 交付包**。

本文档详细介绍独立二进制的构建原理、交叉编译支持、元数据规范以及 Skill 导出结构。

---

## 独立二进制构建原理 (`ac build`)

在执行 `ac build` 时，ActionDock 会自动执行以下构建管线：

```text
扫描当前项目的 actions/ 目录与 actiondock.json 配置
                 |
                 v
动态生成静态 Registry 入口 (.actiondock/.build/entry.ts)
- 静态 import 项目内的每一个 Action
- 创建 StandaloneRuntime 实例并绑定
                 |
                 v
调用 Bun 原生单文件编译引擎
- bun build --compile .actiondock/.build/entry.ts --outfile dist/bin/<package-id>
- 将 TypeScript 代码、所有 npm 依赖及 Bun 极速运行时打包进单个可执行文件
                 |
                 v
计算二进制哈希并生成构建元数据 (dist/bin/artifact.json)
```

### 单包单二进制设计（One Package One Binary）
ActionDock 将一个 Package 内的所有 Action 聚合到**同一个可执行文件**中（例如 `./bin/github-tools`）。
* **避免体积膨胀**：无需为每个 Action 单独打包一个百兆二进制，几十个 Action 共享同一份打包体积。
* **统一工具入口**：通过子命令路由（如 `./bin/github-tools run <action-id>`），符合标准 CLI 交互习惯。

---

## 交叉编译（Cross-Target Compilation）

ActionDock 支持使用 `--target` 参数为不同操作系统和 CPU 架构交叉编译独立二进制：

```bash
# 编译为当前宿主机器架构（默认）
ac build

# 交叉编译为 Linux x86_64 二进制
ac build --target linux-x64

# 交叉编译为 macOS ARM64 (Apple Silicon) 二进制
ac build --target darwin-arm64

# 交叉编译为 Windows x86_64 可执行程序
ac build --target windows-x64
```

---

## 构建元数据规范 (`artifact.json`)

每次编译成功后，系统会在二进制同级目录下生成 `artifact.json` 元数据文件：

```json
{
  "packageId": "fjay.github-tools",
  "name": "GitHub Tools",
  "version": "0.1.0",
  "description": "GitHub 运维与代码评审 Action 集合",
  "target": "host",
  "actions": [
    "github.list-prs",
    "github.get-pr",
    "github.review-pr",
    "github.comment-pr"
  ],
  "bunVersion": "1.4.0",
  "lockHash": "34cbb9a4087e812a",
  "buildHash": "a9b8c7d6e5f41234",
  "createdAt": "2026-08-30T07:00:00.000Z"
}
```

---

### 两种导出模式：全量打包 vs 任务驱动按需打包

#### 1. 全量打包（默认模式）
如果不传任何过滤参数，系统会将项目内**所有的 Action** 和**所有的 Playbook** 打包进 Skill 中：
```bash
ac export skill
# 或打包为 .zip 归档文件
ac export skill --archive
```

#### 2. 任务驱动按需打包（Playbook-Driven Export，推荐）
当项目包含多个业务领域的 Action 和 SOP 时，可通过 `--playbook` 参数指定要导出的 SOP：
```bash
ac export skill --playbook review-pr
```
* **自动依赖解析与裁剪（Tree-shaking）**：系统自动读取 `playbooks/review-pr.md` Frontmatter 中的 `actions` 依赖，仅将该任务所需的 Action 编译进独立二进制，其余无关 Action 自动剔除。
* **干净的产物**：导出的 `playbooks/` 文件夹中仅包含选中的 SOP，生成的 `SKILL.md` 与 `actiondock.skill.json` 仅包含相关 Action 与指南，彻底避免上下文污染与悬空依赖。

#### 3. 工具驱动按需打包（Action-Driven Export）
```bash
# 仅打包指定 Action，并自动裁剪依赖未包含 Action 的 Playbooks
ac export skill --actions github.get-pr github.review-pr

# 仅编译指定 Action 到独立二进制
ac build --actions github.get-pr github.review-pr
```

---

### `SKILL.md` 自动生成规则
导出的 `SKILL.md` 会自动包含：
* **YAML Frontmatter**：包含 `name` 与 `description`，符合 Antigravity、Claude Code、Cursor 等标准 Skill 规范。
* **二进制调用说明**：指导 Agent 如何使用 `./bin/<pkg>` 发现工具（`list --json`）、查看参数定义（`describe <id> --json`）与执行 Action（`run <id> --input '...'`）。
* **Action 目录与参数清单**：自动从每个 Action 的 `inputSchema` 中提取必填与可选参数列表。
* **Playbook SOP 索引**：列出所有可用的操作手册路径。
