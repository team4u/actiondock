---
name: actiondock-project-knowledge-local-maintainer
description: 本地 Claude-first 维护 OCKB 项目知识库。适用于用户要求初始化、刷新、导入或校验 ACTIONDOCK.md 与 .knowledge_base，且希望 Claude 自主开启子 agent 完成 Chief/Planner/Worker 编排，不默认调用 actiondock-project-knowledge 插件。
---

# 本地项目知识库维护器

## 目标

当用户要求生成、刷新、导入或校验项目知识库，并希望走本地 Claude 工作流时，直接在目标仓库内维护 OCKB：

- `ACTIONDOCK.md` 作为项目知识入口
- `.knowledge_base/` 作为正式知识库正文
- `.kb_inbox/` 作为手工资料收件箱
- `.actiondock/project-knowledge/runs/` 可用于记录本地运行摘要

默认不要调用 `actiondock-project-knowledge` 插件；只有用户明确要求平台插件、CLI 或 ActionDock Server 执行时，才切换到插件路径。

## 边界

- 本 skill 是本地执行说明，不要求 ActionDock Server 运行。
- 可以使用 shell、文件读写和子 agent；如果当前 Agent 环境不支持子 agent，则按同一流程串行完成。
- 不自动 stage、commit、push 或创建 PR。
- 不改动与知识库任务无关的用户文件。
- 证据不足时明确写边界，不伪造成确定事实。
- 不优先扫描 `target/`、`dist/`、`build/`、`node_modules/` 等生成目录。

## 目录规范

正式知识库固定使用七大目录：

- `.knowledge_base/01_Architecture_Overview`
- `.knowledge_base/02_API_Specifications`
- `.knowledge_base/03_Data_Models`
- `.knowledge_base/04_Business_Flows`
- `.knowledge_base/05_Agent_Tools_and_CLI`
- `.knowledge_base/06_Infra_and_Env`
- `.knowledge_base/07_Maintenance_and_Ops`

每篇正式正文必须是纯 Markdown，不使用 YAML frontmatter。除 `SUMMARY.md` 外，`.knowledge_base/` 下的正文必须包含 `## 证据与边界`。

## 标准流程

### 1. 确认模式和仓库

根据用户意图选择模式：

- `init`：初始化知识库，覆盖七大领域。
- `refresh`：根据变更文件刷新相关领域；如用户未给 `changedFiles`，用 `git diff --name-status --find-renames HEAD` 推导。
- `ingest`：融合用户提供的资料文件或 `.kb_inbox/` 内容。
- `validate`：只校验现有知识库，不主动重写正文。

仓库路径优先使用用户给出的 `repoPath`；未给时使用当前工作目录。

### 2. 建立基础结构

`init` 时创建七大目录和 `.kb_inbox/`。如果 `ACTIONDOCK.md` 不存在，最后生成默认入口；不要提前写空泛正文。

`refresh` 和 `ingest` 要求仓库已经存在 `ACTIONDOCK.md` 或 `.knowledge_base/`，否则先执行 `init` 逻辑。

### 3. Chief 分诊

开启一个 Chief 子 agent，或者在当前 agent 中执行同等判断。Chief 只根据模式、变更路径、现有知识库目录和 inbox 信息做 phase/domain 路由，不写文件。

Chief 输出结构：

```json
{"phases":[{"phase_num":0,"domains_to_activate":["Data_Model_Planner"]}]}
```

推荐 domain：

- `Chief_Architect`
- `API_Spec_Planner`
- `Data_Model_Planner`
- `Business_Flow_Planner`
- `Agent_Tool_Planner`
- `Infra_Env_Planner`
- `Maintenance_Ops_Planner`
- `Triage_Planner`

### 4. Planner 产出任务

对每个 domain 开启 Planner 子 agent；不同 domain 可并行。Planner 可以读代码和现有文档，但只能输出任务，不写文件。

Planner 输出结构：

```json
{"tasks":[{"action":"UPSERT","target_path":".knowledge_base/03_Data_Models/orders.md","focus_code_entity":"db/migration/V1__init.sql","clue":"更新 orders 表结构"}]}
```

规则：

- `action` 只能是 `UPSERT` 或 `PRUNE`。
- `target_path` 必须位于 `.knowledge_base/` 七大目录内。
- 丢弃绝对路径、`..`、通配符和知识库外路径。
- 相同 `target_path` 只保留一个任务，避免并发写冲突。

### 5. Worker 收敛正文

对安全、去重后的任务开启 Worker 子 agent；只有目标文件互不相同时才并行。每个 Worker 只负责一个 `target_path`。

Worker 要求：

- `UPSERT`：读取旧文档和证据文件，更新或创建目标 Markdown。
- `PRUNE`：仅删除目标文件，不删除目录。
- 正文只写能被代码、配置、DDL、测试、脚本、日志样例或现有文档支持的事实。
- 每篇 `.knowledge_base/` 正文都包含 `## 证据与边界`，列出关键依据和不确定边界。
- 如需图示，使用标准 Mermaid fenced block。
- 完成后返回变更文件和警告。

### 6. 收尾和校验

更新或创建 `ACTIONDOCK.md`，让它指向 `.knowledge_base/SUMMARY.md` 和七大目录。重新生成 `.knowledge_base/SUMMARY.md`，列出现有 Markdown 文档。

如存在 `scripts/validate_ockb.py`，运行：

```bash
python3 skills/actiondock-project-knowledge-local-maintainer/scripts/validate_ockb.py <repoPath>
```

如果当前工作目录不在 ActionDock 仓库内，改用该 skill 安装目录下的脚本路径。校验失败时不要掩盖问题；报告 issue 并说明哪些可以由下一轮修复。

## 回答格式

完成后报告：

- 执行模式
- 主要变更文件
- 校验是否通过
- 仍需人工确认的边界或风险

不要输出长篇过程日志；只保留用户决策和复核需要的信息。
