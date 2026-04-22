# Roadmap: ScriptFlow 代码注释规范化

**Last updated:** 2026-04-22 after initialization

## Phases

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|-----------------|
| 1 | Domain 层注释 | 为域模型层添加专业注释 | COMMENT-01, COMMENT-02, COMMENT-03 | 4/4 criteria met |
| 2 | API 层注释 | 为控制器和接口添加注释 | COMMENT-04 | 3/3 criteria met |
| 3 | Storage 层注释 | 为持久化层添加注释 | COMMENT-05 | 3/3 criteria met |

---

## Phase 1: Domain 层注释

**Goal:** 为 scriptflow-core 模块的域模型层添加符合 Java 规范的专业 Javadoc 注释

**Requirements:** COMMENT-01, COMMENT-02, COMMENT-03

**Success Criteria:**
1. `scriptflow-core/domain/model/` 下所有实体类具有完整 Javadoc
2. `scriptflow-core/application/` 下所有服务类具有方法级注释
3. `scriptflow-core/domain/port/` 下所有接口具有 Javadoc
4. 所有注释符合 JavaDoc 规范，包含 @param, @return, @throws 等标签

---

## Phase 2: API 层注释

**Goal:** 为 Spring Boot Web 层添加 API 文档注释

**Requirements:** COMMENT-04

**Success Criteria:**
1. 所有 Controller 类具有 Javadoc 说明用途
2. 所有 API 端点具有注释说明请求/响应格式
3. 异常处理方法具有 @throws 注释

---

## Phase 3: Storage 层注释

**Goal:** 为 JPA 持久化层添加数据库映射和业务逻辑注释

**Requirements:** COMMENT-05

**Success Criteria:**
1. 所有 Entity 类具有 Javadoc 说明数据库表映射
2. Repository 适配器具有方法级注释
3. JsonCodec 实现类具有说明

---

## Notes

- 每个 Phase 可独立执行
- 注释风格应与 ScriptDefinition.java 现有注释保持一致
- 优先处理核心业务类 (ScriptDefinition, ScriptApplicationService)
