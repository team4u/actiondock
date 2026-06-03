# 后端实现设计

## 1. 概述

后端新增一个 `CliManifestController`，提供 `GET /api/cli/manifest` 端点，根据当前后端配置和已安装插件动态生成 CLI Manifest JSON。同时提供一套注解机制，让各 Controller 方法声明自己的 CLI 暴露方式。

## 2. 新增 API 端点

### 2.1 GET /api/cli/manifest

**认证**：需要 Bearer Token（与其他 `/api/` 端点一致）。

**请求参数**：

| 参数 | 类型 | 位置 | 说明 |
|------|------|------|------|
| `cliVersion` | string | query | CLI 版本号（用于兼容性检查和日志） |

**响应**：

```json
{
  "status": 0,
  "msg": "处理成功",
  "data": {
    "schemaVersion": 1,
    "buildTimestamp": "2026-06-03T10:00:00",
    "serverVersion": "0.1.32",
    "commands": [ ... ]
  }
}
```

**缓存行为**：

- 后端在内存中缓存 Manifest，首次请求时构建，之后直接返回。
- 插件安装/卸载/启动/停止时清除缓存，下次请求时重建。
- 通过 `app.cli-manifest.cache-ttl-seconds` 配置 TTL（默认 300 秒），到期后自动重建。

### 2.2 GET /api/cli/manifest/checksum

轻量端点，返回当前 Manifest 的内容校验和。

**响应**：

```json
{
  "status": 0,
  "msg": "处理成功",
  "data": {
    "checksum": "sha256:a1b2c3...",
    "buildTimestamp": "2026-06-03T10:00:00",
    "commandCount": 85
  }
}
```

CLI 侧可以先调用 checksum 比对本地缓存，仅在变化时才拉取完整 Manifest。

## 3. 注解驱动的 CLI 暴露标记

### 3.1 @CliCommand 注解

```java
package org.team4u.actiondock.cli;

import java.lang.annotation.*;

/**
 * 标记一个 Controller 方法可暴露为 CLI 命令。
 * <p>
 * 标注此注解的方法会被 CliManifestBuilder 自动扫描并生成对应的 CommandDescriptor。
 *
 * @author jay.wu
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CliCommand {

    /**
     * 命令主题（如 "script", "config-value"）。
     */
    String topic();

    /**
     * 命令动作名（如 "list", "get", "run"）。
     */
    String action();

    /**
     * 命令中文描述。
     */
    String description();

    /**
     * 命令别名。
     */
    String[] aliases() default {};

    /**
     * 是否已废弃。
     */
    boolean deprecated() default false;

    /**
     * 废弃提示信息。
     */
    String deprecationMessage() default "";

    /**
     * 位置参数定义。每个元素格式为 "name:description" 或 "name"。
     */
    String[] args() default {};

    /**
     * 额外的 flag 定义（除自动推断的查询参数和请求体字段外）。
     * 格式为 "name:type:required:description" 或 "name:type:description"。
     */
    String[] extraFlags() default {};

    /**
     * 输出渲染类型。
     */
    CliOutput output() default @CliOutput(kind = CliOutputKind.RAW);

    /**
     * 前置条件。
     */
    CliPrecondition[] preconditions() default {};
}
```

### 3.2 @CliOutput 注解

```java
@Target({})
@Retention(RetentionPolicy.RUNTIME)
public @interface CliOutput {

    CliOutputKind kind();

    String entityType() default "";

    String successMessage() default "";
}
```

```java
public enum CliOutputKind {
    LIST, DETAIL, RAW, VOID
}
```

### 3.3 @CliPrecondition 注解

```java
@Target({})
@Retention(RetentionPolicy.RUNTIME)
public @interface CliPrecondition {

    String kind(); // "fetch-schema", "intent-fallback", "resolve-script"

    String[] params() default {};
}
```

### 3.4 @CliParam 注解（用于方法参数级别）

```java
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CliParam {

    /**
     * CLI flag 名称（kebab-case）。默认取 Spring @RequestParam/@PathVariable 的 value。
     */
    String flagName() default "";

    /**
     * flag 类型覆盖。默认自动推断。
     */
    String flagType() default "";

    /**
     * 是否为 CLI flag 必填。默认跟随 @RequestParam(required)。
     */
    boolean required() default true;

    /**
     * 中文描述。
     */
    String description() default "";

    /**
     * enum 类型的可选值。
     */
    String[] options() default {};

    /**
     * 默认值（字符串表示）。
     */
    String defaultValue() default "";

    /**
     * 此参数在 body 中的目标字段名。
     */
    String bodyTarget() default "";

    /**
     * 值变换。
     */
    String transform() default "none";
}
```

## 4. 使用示例

### 4.1 简单 GET 列表

```java
@CliCommand(
    topic = "script",
    action = "list",
    description = "列出可用脚本",
    output = @CliOutput(kind = CliOutputKind.LIST, entityType = "ScriptDefinition"),
    preconditions = @CliPrecondition(kind = "intent-fallback", params = {"intentFlag=intent"})
)
@GetMapping
public ApiResponse<List<ScriptDocumentView>> list(
        @CliParam(description = "包含未发布的脚本") @RequestParam(defaultValue = "false") boolean includeManaged,
        @CliParam(description = "按意图关键词过滤") @RequestParam(required = false) String intent) {
    // ... 现有实现不变
}
```

### 4.2 路径参数 GET

```java
@CliCommand(
    topic = "script",
    action = "get",
    description = "查看脚本详情",
    args = {"scriptId:脚本 ID"},
    output = @CliOutput(kind = CliOutputKind.DETAIL, entityType = "ScriptDefinition")
)
@GetMapping("/{id}")
public ApiResponse<ScriptDocumentView> detail(
        @PathVariable String id,
        @CliParam(description = "查看草稿版本") @RequestParam(defaultValue = "false") boolean draft) {
    // ...
}
```

### 4.3 POST with body

```java
@CliCommand(
    topic = "config-value",
    action = "set",
    description = "设置配置值",
    args = {"key:配置键名"},
    output = @CliOutput(kind = CliOutputKind.DETAIL, entityType = "ConfigValueView")
)
@PutMapping("/{key}")
public ApiResponse<ConfigValueView> update(
        @PathVariable String key,
        @CliParam(flagName = "value", required = true, description = "配置值") @RequestBody ConfigValueRequest request) {
    // ...
}
```

### 4.4 不暴露到 CLI 的端点

不加 `@CliCommand` 注解的方法不会出现在 Manifest 中：

```java
// 管理后台专用，不暴露到 CLI
@PostMapping("/{id}/test-webhook")
public ApiResponse<WebhookExecutionResult> testWebhook(...) { }
```

## 5. Manifest 构建流程

### 5.1 CliManifestBuilder

```
位置: actiondock-app-support/src/main/java/org/team4u/actiondock/cli/CliManifestBuilder.java
```

核心职责：

1. **扫描 Controller 方法**：通过 Spring `ApplicationContext` 获取所有 `@RestController` Bean，反射扫描标注了 `@CliCommand` 的方法。
2. **自动推断参数映射**：
   - `@PathVariable` 参数自动映射为 `pathParams` 和 `args`。
   - `@RequestParam` 参数自动映射为 `queryParams` 和 `flags`。
   - `@RequestBody` 参数标记 bodyKind=json，根据参数类型（Java record/POJO）的字段自动生成 `bodyTemplate` 和 `flags`。
3. **合并注解声明**：注解中的 `args`、`extraFlags`、`preconditions`、`output` 覆盖/补充自动推断结果。
4. **生成 CommandDescriptor 列表**。

### 5.2 自动推断规则

| Spring 参数注解 | 推断结果 |
|---|---|
| `@PathVariable("id")` | pathParams += "id", args += ArgDescriptor(name="id") |
| `@RequestParam("intent")` | queryParams += {name:"intent"}, flags += FlagDescriptor(name:"intent", type:"string") |
| `@RequestParam(defaultValue="false") boolean draft` | flags += FlagDescriptor(name:"draft", type:"boolean", default:"false") |
| `@RequestBody ExecuteRequest` | bodyKind = "json", 从 ExecuteRequest 的字段推断 bodyTemplate |
| `@RequestParam MultipartFile file` | bodyKind = "form-multipart"（此类端点通常不暴露到 CLI） |

### 5.3 RequestBody 字段推断

对于 `@RequestBody SomeRequest request`，`CliManifestBuilder` 反射读取 `SomeRequest` 的字段：

- 基本类型字段（String, Integer, Boolean, Enum）自动映射为 flag。
- Map<String,Object> / List 类型标记为需要 JSON 输入。
- 如果字段名与已存在的 pathParam/queryParam 重名，跳过（避免重复映射）。

### 5.4 构建时序

```text
ApplicationReadyEvent
    |
    v
CliManifestBuilder.build()
    |
    +-> 遍历所有 @RestController Bean
    |       |
    |       +-> 遍历所有 @CliCommand 标注的方法
    |               |
    |               +-> 从方法签名推断 HTTP 绑定
    |               +-> 从 @CliCommand 注解读取声明式覆盖
    |               +-> 合并为 CommandDescriptor
    |
    +-> 组装 CliManifest 对象
    +-> 计算 checksum
    +-> 写入缓存
```

## 6. 缓存策略

### 6.1 缓存实现

```java
public class CliManifestCache {

    private volatile CachedManifest cached;
    private final Instant expiresAt;

    // 插件状态变更时调用
    public void invalidate() { ... }

    // TTL 到期时自动重建
    public CliManifest getOrBuild() { ... }
}
```

缓存存储位置：内存（不需要持久化）。

### 6.2 缓存失效触发

| 事件 | 处理 |
|------|------|
| 插件安装/卸载 | PluginRuntimeService 通知 CliManifestCache.invalidate() |
| 插件启动/停止 | PluginRuntimeService 通知 CliManifestCache.invalidate() |
| TTL 到期 | 下次请求时自动重建 |
| 应用重启 | 缓存丢失，首次请求重建 |

### 6.3 配置

```yaml
# application.yml
app:
  cli-manifest:
    cache-ttl-seconds: 300  # 默认 5 分钟
```

在 `AppProperties` 中新增：

```java
private int cliManifestCacheTtlSeconds = 300;
```

## 7. 与现有 Controller/Service 的集成点

### 7.1 集成方式

**零侵入**：现有 Controller 方法无需修改实现逻辑。只需添加 `@CliCommand` 注解即可声明 CLI 暴露。

集成步骤：

1. 在目标 Controller 方法上添加 `@CliCommand` 注解。
2. 对需要自定义 CLI 参数映射的 Spring 参数添加 `@CliParam` 注解。
3. 不需要 CLI 暴露的端点不加注解，自动排除。

### 7.2 已有的 Manifest-irrelevant 命令

以下命令不通过 Manifest 生成，保留为手写命令：

| 命令 | 原因 |
|------|------|
| `config add/use/remove/set/show/list/clear` | 纯本地操作，不调用远程 API |
| `server` | 本地进程管理 |
| `health` | 调用 `/actuator/health`（非 `/api/` 前缀），逻辑简单 |
| `script run` | 动态 schema 驱动的复杂执行逻辑，保留手写可提供更好的 UX |
| `plugin invoke` | 同上，动态 schema + 多参数源 |
| `script schema` | 前置查询 + 特殊格式输出 |
| `plugin action` | 前置查询 + 特殊格式输出 |

### 7.3 由 Manifest 生成的命令（MVP 范围，约 60 个）

| 主题 | 命令 |
|------|------|
| script | create, delete, patch, publish, discard-draft, fork, validate, upstream-status, upstream-pull |
| script preset | create, delete, list, update |
| execution | get, list, delete, clear |
| schedule | create, update, delete, get, list, enable, disable |
| webhook | create, update, delete, get, list, enable, disable, invoke, upstream-status, upstream-pull |
| plugin | list, get, install, uninstall, upgrade, download, start, stop, references |
| plugin config | get, list, set, delete |
| repository | create, update, delete, list, sync, resolve |
| config-value | list, get, set, delete, copy-local-override, restore-repository-default |
| access-token | create, delete, rename, enable, disable, list |
| state | namespaces, list, get, put, delete, cas, purge-expired |
| playbook | create, update, delete, get, list |

## 8. 需要修改/新增的文件清单

### 8.1 新增文件

| 文件 | 模块 | 说明 |
|------|------|------|
| `actiondock-app-spring/.../cli/CliManifestController.java` | app-spring | Manifest API 端点 |
| `actiondock-app-support/.../cli/CliManifestBuilder.java` | app-support | Manifest 构建器 |
| `actiondock-app-support/.../cli/CliManifestCache.java` | app-support | Manifest 缓存 |
| `actiondock-app-support/.../cli/CliCommand.java` | app-support | @CliCommand 注解 |
| `actiondock-app-support/.../cli/CliOutput.java` | app-support | @CliOutput 注解 |
| `actiondock-app-support/.../cli/CliOutputKind.java` | app-support | 输出类型枚举 |
| `actiondock-app-support/.../cli/CliPrecondition.java` | app-support | @CliPrecondition 注解 |
| `actiondock-app-support/.../cli/CliParam.java` | app-support | @CliParam 注解 |
| `actiondock-app-support/.../cli/CliManifestConfiguration.java` | app-support | Bean 装配配置 |
| `actiondock-app-support/.../cli/descriptor/CommandDescriptor.java` | app-support | 命令描述 DTO（Java record，用于 JSON 序列化） |
| `actiondock-app-support/.../cli/descriptor/HttpBinding.java` | app-support | HTTP 绑定 DTO |
| `actiondock-app-support/.../cli/descriptor/CliManifest.java` | app-support | Manifest 顶层 DTO |

### 8.2 需要修改的文件

| 文件 | 变更内容 |
|------|---------|
| `actiondock-app-support/.../config/AppProperties.java` | 新增 `cliManifestCacheTtlSeconds` 属性 |
| `actiondock-app-spring/.../auth/ApiKeyAuthFilter.java` | 可选：允许 `/api/cli/manifest` 无认证访问（或保持需认证） |
| 各 Controller 文件（渐进式） | 添加 `@CliCommand` 和 `@CliParam` 注解 |
| `actiondock-app-support/.../plugin/PluginRuntimeService.java` | 插件状态变更时通知 Manifest 缓存失效 |

## 9. 替代方案考虑

### 9.1 纯配置文件方式（非注解）

在后端 `resources/` 下维护一份 YAML 配置文件，手动声明每个 CLI 命令。

**优点**：集中管理，一目了然。
**缺点**：与 Controller 方法脱节，新增 API 端点时容易忘记同步更新配置。
**结论**：不采用。注解方式与代码共存，更不容易遗漏。

### 9.2 基于 OpenAPI 自动生成

利用 springdoc 自动生成的 OpenAPI 规范，CLI 侧解析 OpenAPI 生成命令。

**优点**：无需额外注解。
**缺点**：OpenAPI 缺少 CLI 语义信息（输出渲染、前置条件、flag 描述文本）；CLI 侧解析复杂度极高；OpenAPI 膨胀严重（130+ 端点全部暴露，无白名单能力）。
**结论**：不采用。OpenAPI 和 Manifest 互补，各司其职。

### 9.3 编译时代码生成（后端 -> CLI TypeScript）

后端在编译期生成 TypeScript 代码，直接集成到 CLI 模块。

**优点**：类型安全。
**缺点**：破坏前后端独立发布节奏；跨模块构建耦合。
**结论**：不采用。运行时 JSON Manifest 保持松耦合。
