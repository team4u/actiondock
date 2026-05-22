---
name: actiondock-project-knowledge-mantainer
description: 通过 actiondock-project-knowledge 插件触发 OCKB 项目知识库的 Chief/Planner/Worker 多 Agent 编排、刷新、导入和校验。
---

# 项目知识库维护器

## 目标

当用户要求生成、刷新、导入或校验项目知识库时，应调用平台插件 `actiondock-project-knowledge`。

插件负责 OCKB 流程编排：

- 创建 Chief Architect Agent 做全局分诊和 phase 定序
- 创建 Domain Planner Agent 输出本领域 UPSERT / PRUNE 任务
- 创建 Specialized Worker Agent 执行单文件物理收敛
- 记录异步 run 状态并执行最终质量校验

Skill 负责选择 runner、准备输入、解释返回结果。internal Agent 和 external CLI Agent 都由插件通过 `runner` 配置创建，不需要额外工具设计；Agent 自带 shell 能力。

## 标准调用

必需输入：

- `repoPath`：目标仓库根目录

常用可选输入：

- `aiProfile`：internal runner 使用的 Agent profile
- `runner`：选择 internal 或 external-cli
- `changedFiles`：refresh 时提供变更文件；不提供时插件按 Git diff 尝试发现
- `sources`：ingest 时提供手工资料路径

初始化知识库：

```bash
actiondock plugin invoke actiondock-project-knowledge init \
  --args-json '{"repoPath":"/path/to/repo","aiProfile":"project-knowledge-writer","runner":{"type":"internal"}}' \
  --json
```

刷新知识库：

```bash
actiondock plugin invoke actiondock-project-knowledge refresh \
  --args-json '{"repoPath":"/path/to/repo","aiProfile":"project-knowledge-writer","changedFiles":["src/main/java/demo/OrderController.java"],"runner":{"type":"internal"}}' \
  --json
```

外部 CLI Agent：

```bash
actiondock plugin invoke actiondock-project-knowledge refresh \
  --args-json '{"repoPath":"/path/to/repo","runner":{"type":"external-cli","command":["claude","-p"],"timeoutSeconds":900}}' \
  --json
```

导入手工资料：

```bash
actiondock plugin invoke actiondock-project-knowledge ingest \
  --args-json '{"repoPath":"/path/to/repo","aiProfile":"project-knowledge-writer","sources":[".kb_inbox/raw-note.md"],"runner":{"type":"internal"}}' \
  --json
```

单独校验：

```bash
actiondock plugin invoke actiondock-project-knowledge validate \
  --args-json '{"repoPath":"/path/to/repo"}' \
  --json
```

## 结果解释

- action 返回 `status=ACCEPTED` 和 `runId`：任务已进入后台执行。
- `getRun` 返回 `status=SUCCESS`：插件编排完成；查看 `result.status` 判断知识库质量门是否通过。
- `result.status=SUCCESS`：Agent 已完成，质量门通过。
- `result.status=NEEDS_REVIEW`：Agent 已完成，但正式正文校验未通过；文件不会自动回滚。
- `status=FAILED`：Agent 执行、JSON 契约或插件编排异常。

## OCKB 目录

正式知识库使用 `.knowledge_base/` 下 7 大基座目录：

- `01_Architecture_Overview`
- `02_API_Specifications`
- `03_Data_Models`
- `04_Business_Flows`
- `05_Agent_Tools_and_CLI`
- `06_Infra_and_Env`
- `07_Maintenance_and_Ops`

`ACTIONDOCK.md` 只作为项目知识入口；`.knowledge_base/SUMMARY.md` 作为目录索引。

## 边界

- 不自动 stage、commit、push 或创建 PR。
- 不绕过插件直接维护 `ACTIONDOCK.md` 或 `.knowledge_base/`，除非用户明确要求手工修复。
- 不依赖外部元数据数据库、RAG 索引、staging、fingerprint 或 dirty-doc 状态。
- 对证据不足项，必须在正文中说明边界，不伪装成确定事实。
