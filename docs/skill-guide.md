# Skill 设计哲学与交付规范

在 ActionDock 2.0 中，**Skill（技能）**是面向 AI Agent 的最高级自包含交付物。

本文档详细解析 Skill 的核心概念、三位一体构成、设计规范、导出分发机制以及在 AI Agent 生态中的应用生命周期。

---

## 核心概念定位：Action vs Playbook vs Skill

为了让 AI Agent 既能拥有强大的工具执行能力，又能遵守业务规范，ActionDock 建立了清晰的三层能力模型：

```text
+-------------------------------------------------------------------------+
|                              Skill (技能交付包)                          |
|                                                                         |
|  +---------------------------+   +-----------------------------------+  |
|  |     SKILL.md & 元数据     |   |         Playbooks (业务 SOP)      |  |
|  | - Agent 认知与调用指南    |   | - 逐步操作规程                    |  |
|  | - YAML Frontmatter 元信息 |   | - 业务决策分支与安全红线          |  |
|  +-------------+-------------+   +-----------------+-----------------+  |
|                |                                   |                    |
|                +-----------------+-----------------+                    |
|                                  | (驱动与调用)                          |
|                                  v                                      |
|  +-------------------------------------------------------------------+  |
|  |                     Actions (独立二进制底层能力)                  |  |
|  | - 强类型 TypeScript 实现                                          |  |
|  | - 标准 JSON Schema 严格校验入参与出参                             |  |
|  | - 零外部依赖自包含执行                                             |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

### 三者职责划分

* **Action（动作/工具）**：底层的原子执行单元。由开发者使用 TypeScript 编写，声明强类型的 `inputSchema` 和 `outputSchema`，负责具体的 API 调用、数据计算或系统操作。
* **Playbook（剧本/操作规程）**：中层的任务规程。使用 Markdown 编写，指导 AI Agent 按照正确的先后顺序、业务约束和安全红线来编排与调用多个 Action。
* **Skill（技能包）**：顶层的完整交付实体。将 Action 的编译产物（独立二进制）、Playbook SOP 与 `SKILL.md` 指南打包为一体，供 AI Agent 直接加载并即刻使用。

---

## Skill 交付包的标准构成

通过 `ac export skill` 命令导出的 Skill 目录遵循业界通用的自包含交付规范：

```text
dist/github-tools-skill/
├── SKILL.md                  # 面向 AI Agent 的主引导手册（含 YAML Frontmatter）
├── actiondock.skill.json     # 机器可读的结构化清单（包含全量 Action Schema）
├── playbooks/                # 业务操作规程 Markdown 目录
│   └── review-pr.md
└── bin/
    └── github-tools          # 独立自包含二进制（无需预装 Node/Bun/Python/Java）
```

### `SKILL.md` 规范与元数据结构
`SKILL.md` 是 Agent 读取并理解 Skill 能力的第一入口，必须在文件最顶部包含标准 YAML Frontmatter：

```markdown
---
name: github-tools
description: GitHub 运维、代码评审与 Pull Request 自动化处理技能
---

# GitHub Tools

本技能为 AI Agent 提供完整的 GitHub 自动化交互能力。

## 如何调用 Action

使用 Skill 目录中自带的独立可执行文件 `./bin/github-tools` 即可完成工具发现与调用。
该工具无需在系统预先安装任何依赖。

### 发现可用 Action 清单
```bash
./bin/github-tools list --json
```

### 查看 Action 结构与入参 Schema
```bash
./bin/github-tools describe <action-id> --json
```

### 执行 Action
```bash
./bin/github-tools run <action-id> --input '{"param": "value"}'
```
```

### `actiondock.skill.json` 机器清单
除人类/Agent 可读的 Markdown 外，Skill 包还提供纯 JSON 格式的元数据清单，便于宿主程序做静态工具注册：

```json
{
  "schemaVersion": "2.0.0",
  "packageId": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "1.0.0",
  "description": "GitHub 运维与代码评审 Action 集合",
  "target": "host",
  "executable": "./bin/github-tools",
  "actions": [
    {
      "id": "github.list-prs",
      "description": "获取 GitHub 仓库的 Pull Requests 清单",
      "inputSchema": { ... },
      "outputSchema": { ... }
    }
  ],
  "exportedAt": "2026-08-30T07:00:00.000Z"
}
```

---

## Skill 的设计原则与最佳实践

### 职责单一与高内聚
一个 Skill 应围绕明确的领域场景组织（如 `k8s-ops`、`github-tools`、`jira-workflow`），避免将无关的跨领域工具打包在同一个 Skill 中。

### 零运行环境假设（Zero-Environment Assumption）
Skill 的使用者可能是沙箱容器、远程无网络环境或最小化 Linux 系统。ActionDock 保证 Skill 内的二进制是自包含的，绝不假定目标机器安装了 Node.js、Bun、Python 或系统级库。

### 提示词引导与红线保护
在 `SKILL.md` 和关联的 Playbook 中，必须清晰注明操作前提、参数示例、常见报错处理以及不可逾越的业务红线（如禁止静默删除、强制审批条件）。

---

## Skill 的导出与归档分发

### 基础导出
```bash
ac export skill
```
默认输出至 `dist/<package-name>-skill/`。

### 针对不同操作系统交叉导出
```bash
# 导出适配 Linux 服务器的 Skill
ac export skill --target linux-x64

# 导出适配 Apple Silicon Mac 的 Skill
ac export skill --target darwin-arm64

# 导出适配 Windows 的 Skill
ac export skill --target windows-x64
```
系统会自动在目录名追加平台后缀（如 `dist/github-tools-skill-linux-x64/`），避免多平台构建产物相互覆盖。

### 打包为 ZIP 压缩包分发
```bash
ac export skill --archive
```
自动生成 `dist/<package-name>-skill.zip` 归档文件，方便直接上传分发至插件市场或分发给其他团队。

---

## AI Agent 使用 Skill 的运行时生命周期

```text
1. 技能发现 (Discovery)
   Agent 读取 custom/skills/ 目录下的 SKILL.md，识别 YAML Frontmatter 中的 name 和 description。

2. 意图匹配 (Activation)
   当用户提出相关任务时，Agent 根据 SKILL.md 激活对应技能。

3. SOP 阅读 (Guidance)
   Agent 查阅 playbooks/ 中的 Markdown 规程，明确执行步骤与安全红线。

4. 工具调用 (Execution)
   Agent 执行 ./bin/<pkg> run <action-id> --input '...'，捕获 stdout 标准 JSON 返回值完成任务。
```
