# Phase 1: Domain 层注释 - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Source:** Project initialization

## Phase Boundary

为 scriptflow-core 模块的域模型层添加符合 Java 规范的专业 Javadoc 注释。

包含：
- Domain Model: 实体类和值对象
- Application Service: 应用服务层
- Port Interfaces: 抽象端口接口

## Implementation Decisions

### 注释标准
- 使用 JavaDoc 标准格式
- 中文注释，与现有代码保持一致
- @author 标签: jay.wu
- @param/@return/@throws 标签必需

### 注释优先级
1. 核心业务类优先 (ScriptDefinition, ExecutionRecord)
2. 应用服务类次之
3. 端口接口最后

### 排除范围
- private 辅助方法（除非逻辑复杂）
- getter/setter 方法（除非有业务含义）
- 框架注解 (@Entity, @Table 等)

## Specific Ideas

### Domain Model 文件列表
```
scriptflow-core/src/main/java/org/team4u/scriptflow/domain/model/
├── ScriptDefinition.java     (已有注释)
├── ExecutionRecord.java
├── ScriptExecutionContext.java
├── ScriptType.java
├── ScriptStatus.java
├── ExecutionStatus.java
├── SubmitMode.java
├── PublishedScriptSnapshot.java
├── PluginRegistration.java
├── PluginActionMetadata.java
└── SchemaValueCopier.java
```

### Application Service 文件列表
```
scriptflow-core/src/main/java/org/team4u/scriptflow/application/
├── ScriptApplicationService.java
├── ExecutionApplicationService.java
├── ExecutionOutputProjector.java
├── InvalidExecutionInputException.java
├── SchemaFieldError.java
├── ScriptSchemaSupport.java
└── schema/
```

### Port Interface 文件列表
```
scriptflow-core/src/main/java/org/team4u/scriptflow/domain/port/
├── ScriptRepository.java
├── ScriptEngine.java
├── ExecutionRepository.java
├── JsonCodec.java
└── PluginRegistryRepository.java
```

## Deferred Ideas

无

## Canonical References

### 注释风格参考
- `scriptflow-core/src/main/java/org/team4u/scriptflow/domain/model/ScriptDefinition.java` — 现有注释风格标准
