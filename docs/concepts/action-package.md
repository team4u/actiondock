# 核心概念：Action Package

**Action Package** 是 ActionDock 体系中最核心的一级软件资产抽象。

在过去，AI Agent 的工具通常是散落的脚本文件、Prompt 提示词片段，或者是可视化画布里的连线。ActionDock 将其重构为一个**自包含、版本化、可测试、可独立编译的工程单元** —— Action Package。

---

## 四大核心支柱

Action Package 围绕四个基本维度组织：

```text
Action Package
    │
    ├─ 能力 (Capability) → Action (原子执行单元)
    │
    ├─ 规程 (Procedure)  → Playbook (标准操作手册与红线拦截)
    │
    ├─ 契约 (Contract)   → Schema (严格的 JSON Schema 输入输出规范)
    │
    └─ 运行态 (Runtime)  → ActionContext (配置、存储、日志与取消链路)
```

1. **能力 (Capability) → Action**：定义 Agent「能做什么」。每个 Action 是一个原子函数，负责确定性的数据交互、外部 API 调用或本地计算。
2. **规程 (Procedure) → Playbook**：定义 Agent「该怎么做」。通过 Markdown 结构化编写领域知识、步骤时序、前置校验与安全红线。
3. **契约 (Contract) → Schema**：代码即契约。利用 JSON Schema 精确声明入参、出参和字段说明，消除大模型幻觉与文档脱节。
4. **运行态 (Runtime) → ActionContext**：为 Action 提供统一的运行环境，包括 5 级配置回退、SQLite 持久化状态存储、强制 `stderr` 隔离的结构化日志以及 Web 原生 `AbortSignal`。

---

## 目录结构解剖

一个典型的 Action Package 目录结构如下：

```text
github-tools/
├── actiondock.json       # 项目元数据清单与默认配置
├── package.json          # TypeScript 与 npm 依赖配置
├── tsconfig.json         # 编译配置
│
├── actions/              # [能力与契约] 原子 Action 定义
│   ├── get-pr.ts         # 获取 PR 详情
│   ├── create-comment.ts # 发表评论
│   └── merge-pr.ts       # 合并 PR
│
├── playbooks/            # [规程] 面向 Agent 的 SOP 规程
│   └── review-pr.md      # 代码评审全流程规程与高危拦截规范
│
└── tests/                # 自动化测试用例
    └── github-tools.test.ts # 纯内存单元与集成测试
```

---

## `actiondock.json` 清单定义

`actiondock.json` 是 Action Package 的核心清单文件：

```json
{
  "packageId": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "2.0.0",
  "description": "GitHub 自动化运维与代码评审工具集",
  "configSchema": {
    "type": "object",
    "properties": {
      "GITHUB_TOKEN": {
        "type": "string",
        "description": "GitHub Personal Access Token"
      }
    },
    "required": ["GITHUB_TOKEN"]
  },
  "defaultConfig": {
    "API_BASE": "https://api.github.com"
  }
}
```

---

## 生命周期与交付目标

Action Package 是「一次编写，全模态交付」的物理载体：

```text
                     ┌─ ac run (本地 CLI 调试)
                     │
                     ├─ ac test (毫秒级内存单测)
                     │
Action Package ──────┼─ ac mcp (STDIO / HTTP MCP 服务直连 IDE)
 (actions/ +         │
  playbooks/)        ├─ ac serve (轻量 HTTP 微服务，支持多云调度)
                     │
                     ├─ ac export skill (导出自包含 Agent Skill)
                     │
                     └─ ac build (编译为零依赖单文件独立二进制)
```

无论通过何种形式运行，Action Package 内部的业务逻辑、Schema 校验规则、配置优先级与状态持久化行为均严格保持一致（**独立编译契约原则**）。
