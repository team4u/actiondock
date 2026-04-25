---
phase: "1"
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptApplicationService.java
  - actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionApplicationService.java
  - actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionOutputProjector.java
  - actiondock-core/src/main/java/org/team4u/actiondock/application/InvalidExecutionInputException.java
  - actiondock-core/src/main/java/org/team4u/actiondock/application/SchemaFieldError.java
  - actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptSchemaSupport.java
autonomous: true
requirements:
  - COMMENT-02
must_haves:
  truths:
    - "Application service classes have class-level Javadoc explaining their purpose"
    - "Public methods have Javadoc with @param, @return, @throws tags"
    - "Exception classes have Javadoc explaining error conditions"
  artifacts:
    - path: "actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptApplicationService.java"
      provides: "Script management operations"
      min_lines: 10
    - path: "actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionApplicationService.java"
      provides: "Script execution operations"
      min_lines: 10
    - path: "actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionOutputProjector.java"
      provides: "Output projection logic"
      min_lines: 5
    - path: "actiondock-core/src/main/java/org/team4u/actiondock/application/InvalidExecutionInputException.java"
      provides: "Input validation exception"
      min_lines: 5
    - path: "actiondock-core/src/main/java/org/team4u/actiondock/application/SchemaFieldError.java"
      provides: "Schema validation error details"
      min_lines: 5
    - path: "actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptSchemaSupport.java"
      provides: "Schema validation support"
      min_lines: 5
  key_links:
    - from: "ScriptApplicationService"
      to: "ScriptRepository"
      via: "dependency injection"
    - from: "ExecutionApplicationService"
      to: "ExecutionRepository"
      via: "dependency injection"
---

<objective>
为 actiondock-core 模块的 Application 层添加符合 Java 规范的专业 Javadoc 注释。

包含 6 个类/记录：ScriptApplicationService, ExecutionApplicationService, ExecutionOutputProjector, InvalidExecutionInputException, SchemaFieldError, ScriptSchemaSupport。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ScriptDefinition.java
@actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptApplicationService.java
@actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionApplicationService.java
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Javadoc to ScriptApplicationService</name>
  <files>actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptApplicationService.java</files>
  <action>
使用 Edit 工具添加 Javadoc 注释，参考 ScriptDefinition.java 的注释风格。

**类级别 Javadoc** (在 `public class ScriptApplicationService {` 之前插入):
```java
/**
 * 脚本管理服务，提供脚本的 CRUD 操作和发布管理。
 * <p>
 * 负责脚本的创建、更新、查询、删除以及发布状态管理。
 * 通过依赖注入的 ScriptRepository 和 ScriptEngine 实现业务逻辑。
 *
 * @author jay.wu
 */
```

**方法级别 Javadoc**:
- `save(ScriptDefinition definition)` - 添加 `@param definition 脚本定义` 和 `@return 保存后的脚本定义`
- `get(String id)` - 添加 `@param id 脚本ID` 和 `@return 脚本定义，不存在则抛出 IllegalArgumentException`
- `getPublished(String id)` - 添加 `@param id 脚本ID` 和 `@return 已发布状态的脚本定义`
- `list()` - 添加 `@return 所有脚本定义列表`
- `delete(String id)` - 添加 `@param id 脚本ID`
- `validate(String id)` - 添加 `@param id 脚本ID`
- `publish(String id)` - 添加 `@param id 脚本ID` 和 `@return 发布后的脚本定义`
- `discardDraft(String id)` - 添加 `@param id 脚本ID` 和 `@return 丢弃草稿后的脚本定义`
- `normalizePublicationState(ScriptDefinition definition)` - 添加 `@param definition 脚本定义`，注意这是 private 方法，只需简单说明即可
</action>
  <verify>
grep -c "^ \* " actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptApplicationService.java
</verify>
  <done>ScriptApplicationService 类有完整的类级别和方法级别 Javadoc</done>
</task>

<task type="auto">
  <name>Task 2: Add Javadoc to ExecutionApplicationService</name>
  <files>actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionApplicationService.java</files>
  <action>
使用 Edit 工具添加 Javadoc 注释。

**类级别 Javadoc**:
```java
/**
 * 脚本执行服务，提供脚本的执行和管理功能。
 * <p>
 * 支持同步和异步两种执行模式，负责执行记录的创建、查询和清理。
 * 通过依赖注入的 ScriptRepository、ExecutionRepository 和 ScriptEngine 实现业务逻辑。
 *
 * @author jay.wu
 */
```

**方法级别 Javadoc**:
- `execute(String scriptId, Map<String, Object> input, SubmitMode submitMode)` - 添加 `@param scriptId 脚本ID` `@param input 输入参数` `@param submitMode 提交模式` `@return 执行记录`
- `executePublished(String scriptId, Map<String, Object> input, SubmitMode submitMode)` - 添加同上 `@return 执行记录`
- `run(ScriptDefinition definition, ExecutionRecord record)` - private 方法，添加 `@param definition 脚本定义` `@param record 执行记录` `@return 执行记录`
- `toMap(Object result)` - private 方法，添加 `@param result 原始结果` `@return 转换后的 Map`
- `get(String id)` - 添加 `@param id 执行记录ID` `@return 执行记录`
- `list(String scriptId)` - 添加 `@param scriptId 脚本ID，可为 null` `@return 执行记录列表`
- `delete(String id)` - 添加 `@param id 执行记录ID`
- `clear(String scriptId)` - 添加 `@param scriptId 脚本ID`
</action>
  <verify>
grep -c "^ \* " actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionApplicationService.java
</verify>
  <done>ExecutionApplicationService 类有完整的类级别和方法级别 Javadoc</done>
</task>

<task type="auto">
  <name>Task 3: Add Javadoc to remaining Application classes</name>
  <files>
    actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionOutputProjector.java
    actiondock-core/src/main/java/org/team4u/actiondock/application/InvalidExecutionInputException.java
    actiondock-core/src/main/java/org/team4u/actiondock/application/SchemaFieldError.java
    actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptSchemaSupport.java
  </files>
  <action>
使用 Edit 工具分别为以下 4 个文件添加 Javadoc：

**1. ExecutionOutputProjector.java**:
```java
/**
 * 执行输出投影器，根据输出模式过滤原始执行结果。
 * <p>
 * 用于将脚本的完整执行输出根据定义的输出模式进行过滤，
 * 只保留用户期望看到的输出字段。
 *
 * @author jay.wu
 */
```
方法 `project()`: 添加 `@param rawOutput 原始输出` `@param outputSchema 输出模式` `@return 投影后的输出`

**2. InvalidExecutionInputException.java**:
```java
/**
 * 输入参数校验失败异常。
 * <p>
 * 当脚本执行时输入参数不符合定义的模式时抛出。
 * 包含具体的字段错误信息，便于客户端定位问题。
 *
 * @author jay.wu
 */
```
添加 getter 方法的 `@return` 注释。

**3. SchemaFieldError.java** (record):
```java
/**
 * 模式校验字段错误，记录单个字段的校验失败信息。
 *
 * @param field 字段名称
 * @param reason 错误原因代码
 * @param message 人类可读的错误消息
 * @param expected 期望的值或类型
 * @param actual 实际的值或类型
 *
 * @author jay.wu
 */
```

**4. ScriptSchemaSupport.java**:
```java
/**
 * 脚本模式支持类，提供输入参数的校验和解析功能。
 * <p>
 * 支持 JSON Schema 风格的模式定义，包括必填字段、类型校验和枚举值校验。
 *
 * @author jay.wu
 */
```
- `summarize(Map<String, Object> schema)` - 添加 `@param schema 模式定义` `@return 模式摘要`
- `validateInput(String scriptId, Map<String, Object> input, Map<String, Object> schema)` - 添加 `@param scriptId 脚本ID` `@param input 输入参数` `@param schema 模式定义` `@throws InvalidExecutionInputException 当校验失败时`
</action>
  <verify>
grep -c "^ \* " actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionOutputProjector.java && grep -c "^ \* " actiondock-core/src/main/java/org/team4u/actiondock/application/InvalidExecutionInputException.java && grep -c "^ \* " actiondock-core/src/main/java/org/team4u/actiondock/application/SchemaFieldError.java && grep -c "^ \* " actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptSchemaSupport.java
</verify>
  <done>所有 Application 层类都有 Javadoc 注释</done>
</task>

</tasks>

<verification>
- grep -c "^/\\*\\*" actiondock-core/src/main/java/org/team4u/actiondock/application/*.java 应返回 6 (6 个文件都有 Javadoc 块)
- grep "@author jay.wu" actiondock-core/src/main/java/org/team4u/actiondock/application/*.java 应返回 6
</verification>

<success_criteria>
- [x] ScriptApplicationService 有完整类级别和方法级别 Javadoc
- [x] ExecutionApplicationService 有完整类级别和方法级别 Javadoc
- [x] ExecutionOutputProjector 有类和方法 Javadoc
- [x] InvalidExecutionInputException 有类级别 Javadoc
- [x] SchemaFieldError 有 record 级别的 Javadoc
- [x] ScriptSchemaSupport 有类和方法 Javadoc
- [x] 所有注释使用中文，包含 @author jay.wu
</success_criteria>

<output>
After completion, create `.planning/phases/01-domain-注释/{phase}-01-SUMMARY.md`
</output>
