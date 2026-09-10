# 核心概念：Action Package

**Action Package** 是 ActionDock 体系中最核心的一级软件资产抽象。

ActionDock 将智能体工具重构为一个**自包含、版本化、可测试、可独立交付的工程单元** —— Action Package。

---

## 四大核心支柱

Action Package 围绕四个基本维度组织：

```text
Action Package
    │
    ├─ 原子能力 → Action（确定性任务执行单元）
    │
    ├─ 操作规程 → Playbook（标准作业规程与安全底线）
    │
    ├─ 契约规范 → Schema（严格的输入输出模式规范）
    │
    └─ 运行时态 → ActionContext（多级配置、状态存储、进程治理与日志）
```

- 原子能力：定义智能体能做什么。每个 Action 是一个原子函数，负责确定性的数据交互、外部接口调用或本地计算。
- 操作规程：定义智能体该怎么做。通过 Markdown 结构化编写领域知识、步骤时序、前置校验与安全红线。
- 契约规范：代码即契约。利用 JSON Schema 精确声明入参、出参和字段说明，消除模型幻觉与文档脱节。
- 运行时态：为 Action 提供统一运行环境，包括 5 级配置回退、SQLite 持久化状态存储、强制标准错误流隔离的结构化日志以及标准取消信号。

---

## 目录结构解剖

一个典型的 Action Package 目录结构如下：

```text
github-tools/
├── actiondock.json       # 项目元数据与契约清单（唯一事实源）
├── actiondock.lock.json  # 跨包依赖锁定文件（事实源）
├── package.json          # TypeScript 与 npm 依赖配置
├── tsconfig.json         # 编译配置
│
├── actions/              # 原子 Action 实现源码
│   ├── get-pr.ts         # 获取 PR 详情
│   ├── create-comment.ts # 发表评论
│   └── merge-pr.ts       # 合并 PR
│
├── playbooks/            # 面向智能体的操作规程
│   └── review-pr.md      # 代码审查全流程规程与高危拦截规范
│
└── tests/                # 自动化测试用例
    └── github-tools.test.ts # 纯内存单元与集成测试
```

---

## `actiondock.json` 清单定义

`actiondock.json`（规范版本号为 2）是 Action Package 的核心清单文件，作为整个项目元数据与契约规范的唯一事实源：

```json
{
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "2.0.0",
  "description": "GitHub 自动化运维与代码审查工具集",
  "config": {
    "GITHUB_TOKEN": {
      "type": "string",
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "required": true,
      "env": "GITHUB_TOKEN"
    },
    "API_BASE": {
      "type": "string",
      "description": "GitHub API 根地址",
      "default": "https://api.github.com"
    }
  },
  "actions": {
    "get-pr": {
      "entry": "actions/get-pr.ts",
      "description": "获取指定 PR 详细信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": { "type": "string" },
          "pullNumber": { "type": "number" }
        },
        "required": ["repo", "pullNumber"]
      }
    }
  },
  "playbooks": {
    "review-pr": {
      "entry": "playbooks/review-pr.md",
      "description": "PR 代码审查标准操作规程",
      "actions": ["get-pr"]
    }
  },
  "dependencies": {
    "team4u.common-utils": "^1.0.0"
  }
}
```

配套的 `actiondock.lock.json` 作为依赖锁定事实源，记录已解析依赖的精确版本与完整性校验摘要。

---

## 生命周期与全模态交付

Action Package 是「一次开发，全模态交付」的物理载体：

```text
                     ┌─ ad run（本地命令行调试）
                     │
                     ├─ ad test（毫秒级内存单测）
                     │
                     ├─ ad mcp（STDIO 或 HTTP 协议服务直连集成开发环境）
Action Package ──────┼─ ad serve（轻量 HTTP 微服务，支持多云调度）
 (actions/ +         │
  playbooks/)        ├─ ad build（构建为 Node.js 运行时交付目录或压缩归档）
                     │
                     ├─ ad pack（打包为标准 npm 压缩包用于分发）
                     │
                     └─ ad export skill（导出源码型或 Node.js 目录型智能体技能）
```
