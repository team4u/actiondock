# Document Granularity：文档颗粒度规则

目标是让知识库长期可维护，而不是把事实堆进 `ACTIONDOCK.md` 或各类 `index.md`。v4.4 起，颗粒度规则按风险触发：小改动不强制拆文档；一旦涉及独立实体或正文事实，就必须使用 leaf substantive doc。

## 1. 文档类型

### Navigation / index docs

只做入口、目录、状态和跳转。

常见路径：

- `ACTIONDOCK.md`
- `docs/code/index.md`
- `docs/code/workspaces.md`
- `docs/api/http.md`
- `docs/api/events.md`
- `docs/data/index.md`
- `docs/domain/flows/index.md`
- `docs/ops/config/index.md`
- `docs/diagnosis/index.md`

允许内容：

- 简短范围说明。
- 链接到 leaf docs。
- 已建立 / 待建立 / 暂无证据 / 不适用状态。
- 最近维护状态和证据缺口摘要。

不允许内容：

- 多个具体业务流程正文。
- 完整 endpoint schema 或 DTO 字段。
- 表字段和迁移细节。
- 多步骤 runbook。
- 诊断决策树。
- service/package 实现细节。

### Substantive leaf docs

承载具体事实、流程、接口、数据、配置、运维步骤或诊断路径。

必须包含：

- 目的与范围
- 当前行为
- 关键文件
- 适用的接口 / 数据 / 流程 / 运维说明
- 证据与边界
- 维护备注

`证据与边界` 可以很短，但必须说明证据路径和不确定边界。

## 2. 什么时候必须拆 leaf doc

出现以下任一情况，必须创建或更新 leaf doc：

- 一个命名业务流程有独立生命周期、状态流或异常路径。
- 一个 HTTP resource group 有独立 schema、权限或状态码。
- 一个事件族有 producer / consumer / payload contract。
- 一个数据表有独立语义、状态字段、关系或 migration。
- 一个跨表事务有一致性边界。
- 一个配置域影响运行行为或部署。
- 一个 runbook 有可执行步骤。
- 一个诊断路径有判断条件或修复动作。
- 一个 service/package 在 monorepo 中有独立责任。

## 3. 小改动例外

XS/S 可以不创建新 leaf doc 的情况：

- 只更新已有 leaf doc 中的一行配置说明。
- 只修复 index 的链接或状态。
- 只把一个新文档加入导航。
- 只记录一个待确认 evidence gap。
- 只更新 `ACTIONDOCK.md` 的入口状态。

例外不能用于把正文事实继续塞入 index。

## 4. Index 内容下沉风险

如果 index/navigation doc 出现以下信号，应报告 `index_content_sink`：

- 超过一个具体实体的长段正文。
- 多个二级标题分别描述不同 API/flow/table/config。
- 出现完整步骤列表、字段表、错误码表、状态机表。
- index 成为事实主来源，而 leaf docs 缺失。

修复方式：

1. 建立或更新 leaf docs。
2. 把 index 改回导航和状态。
3. 保留人工 TODO 和重要备注，迁移到最相关的 leaf doc 或 index 的“待处理”区。

## 5. 推荐路径

| 实体类型 | 推荐路径 |
|---|---|
| 业务流程 | `docs/domain/flows/<flow-name>.md` |
| 状态机 | `docs/domain/state-machines/<machine-name>.md` |
| HTTP 资源组 | `docs/api/http/<resource>.md` |
| 事件族 | `docs/api/events/<event-family>.md` |
| 集成系统 | `docs/integrations/<system>.md` |
| 数据表 | `docs/data/tables/<table>.md` |
| 跨表事务 | `docs/data/transactions/<transaction>.md` |
| 配置域 | `docs/ops/config/<config-domain>.md` |
| 诊断路径 | `docs/diagnosis/<symptom-or-failure>.md` |
| 维护 runbook | `docs/ops/maintenance/<operation>.md` |
| 服务 | `docs/services/<service>.md` |
| package | `docs/packages/<package>.md` |

## 6. Validator 严重性建议

| 问题 | XS/S | M | L/XL |
|---|---|---|---|
| index 有少量正文但不影响维护 | info | warning | warning |
| index 承载多个实体正文 | warning | error | error |
| 新实体没有 leaf doc | warning | warning/error | error |
| document_set_plan 缺失但未触发 required | 无需报告 | info | 不适用 |
| document_set_plan required 但缺失 | warning | error | error |
