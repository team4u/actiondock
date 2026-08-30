# Playbook SOP 编写规范与最佳实践

Playbook 是 ActionDock 2.0 中面向 AI Agent 的**标准操作规程（Standard Operating Procedure，SOP）**文档。

本文档介绍 Playbook 的设计哲学、结构规范、编写技巧以及与 Action 的联动验证。

---

## 什么是 Playbook？

AI Agent 拥有强大的推理能力，但在处理具体的领域业务时，往往面临以下挑战：
* 不清楚应该以什么先后顺序组合调用 Action。
* 不了解业务安全边界（例如“哪些操作可以自动执行，哪些操作绝对不能自动合并”）。
* 在遇到异常时缺乏明确的排查和应对准则。

**Playbook 就是写给 AI Agent 的业务操作指南**。它用规范的 Markdown 语言清晰告知 Agent：
* 本任务的目标是什么。
* 需要按照什么顺序调用哪些 Action。
* 关键业务检查点与防护准则。

---

## Playbook 文件组织与结构规范

Playbook 文件统一存放在项目的 `playbooks/` 目录下（如 `playbooks/review-pr.md`）。

每个 Playbook 包含两个部分：
* **YAML Frontmatter**：结构化元数据。
* **Markdown 正文**：SOP 指南内容。

### 结构模板

```markdown
---
id: deploy-service
description: 服务上线与灰度发布自动化操作规程
actions:
  - k8s.check-cluster-health
  - k8s.apply-deployment
  - k8s.verify-pod-status
  - notification.send-alert
---

# 服务上线与灰度发布标准操作规程 (SOP)

本规程指导 AI Agent 使用本工具包完成生产环境服务的自动化发布与健康度检查。

## 前置检查

* 调用 `k8s.check-cluster-health` 检查目标集群可用容量。
* 检查待发布的镜像标签是否已在仓库就绪。

## 详细发布步骤

### 阶段一：下发灰度部署配置
* 调用 `k8s.apply-deployment`，将 `canaryWeight` 设置为 10%。

### 阶段二：健康状态轮询
* 连续 3 次调用 `k8s.verify-pod-status`。
* 若 Pod 出现 `CrashLoopBackOff`，立即停止发布并触发告警。

### 阶段三：全量发布与通知
* 验证通过后全量下发，调用 `notification.send-alert` 发送上线成功卡片。

## 安全红线（Agent 必须严格遵守）

* 严禁在工作日核心业务高峰期（10:00 - 12:00, 14:00 - 18:00）执行全量上线。
* 若健康检查失败，绝不可跳过错误继续执行。
```

---

## Playbook 编写最佳实践

### 明确关联 Actions
在 Frontmatter 的 `actions` 列表中，完整列出当前 SOP 所依赖的所有 Action ID。
使用 `ac playbook validate` 可以自动检查这些 Action ID 是否在当前项目中真实存在。

### 区分“建议”与“红线”
在正文中为 Agent 明确设立不可逾越的“安全红线”（如无人工确认绝不删除数据、不可自动合并未经审批的 PR）。

### 提供明确的排错与分支决策
不要仅写一条理想路径，应明确告知 Agent 遇到何种错误返回值时应如何处理（如“若返回 404 则调用 Action B 尝试初始化”）。

---

## CLI 管理与校验

### 创建 Playbook
```bash
ac playbook create review-pr --desc "GitHub PR 自动化评审 SOP" --actions github.get-pr github.review-pr github.comment-pr
```

### 查看 Playbook 详情
```bash
ac playbook show review-pr
```

### 校验 Playbook 合法性
```bash
ac playbook validate
```
`ac playbook validate` 会自动检查：
* Frontmatter 是否包含必填的 `id`。
* 正文内容是否为空。
* `actions` 中声明引用的每个 Action ID 是否在当前项目中真实存在，并在缺失时给出警告提示。
