# Requirements: ActionDock 代码注释规范化

**Last updated:** 2026-04-22 after initialization

## Traceability

| REQ-ID | Requirement | Phase | Status |
|--------|------------|-------|--------|
| COMMENT-01 | Domain 层实体类 Javadoc | 1 | Active |
| COMMENT-02 | Application 层方法注释 | 1 | Active |
| COMMENT-03 | Port 层接口注释 | 2 | Active |
| COMMENT-04 | Web 层 API 注释 | 2 | Active |
| COMMENT-05 | Storage 层实体注释 | 3 | Active |

---

## v1 Requirements

### Code Documentation (注释规范)

- [ ] **COMMENT-01**: Domain 层实体类 Javadoc 注释
  - 为 `actiondock-core/domain/model/` 下所有实体类添加 Javadoc
  - 包含类用途、作者信息 (@author)、关键业务规则说明
  - 重点类：ScriptDefinition, ExecutionRecord, ScriptExecutionContext, PublishedScriptSnapshot

- [ ] **COMMENT-02**: Application 层服务类注释
  - 为 `actiondock-core/application/` 下所有服务类添加注释
  - 方法级注释说明业务逻辑、入参、返回值
  - 重点类：ScriptApplicationService, ExecutionApplicationService

- [ ] **COMMENT-03**: Port 层接口注释
  - 为 `actiondock-core/domain/port/` 下所有接口添加 Javadoc
  - 说明接口用途、设计意图
  - 重点接口：ScriptRepository, ScriptEngine, ExecutionRepository

- [ ] **COMMENT-04**: Web 层控制器注释
  - 为 `actiondock-app-spring/` 下所有 Controller 添加 Javadoc
  - API 端点说明 (@GetMapping, @PostMapping 等)
  - 重点类：ScriptController, ExecutionController, SchemaController

- [ ] **COMMENT-05**: Storage 层实体注释
  - 为 `actiondock-storage-jpa/` 下所有实体和适配器添加注释
  - 数据库映射说明 (@Table, @Column 等)
  - 重点类：ScriptEntity, ExecutionEntity, JpaScriptRepositoryAdapter

---

## v2 Requirements (Deferred)

- 为复杂业务逻辑添加行内注释
- 为单元测试类添加注释
- 生成 API 文档

---

## Out of Scope

- 注释 private 字段（除非有特殊业务含义）
- 注释框架自动生成的代码
- 重构代码逻辑（仅添加注释）
