# 系统设置

## 一句话理解

系统设置提供平台级别的治理功能：配置值（全局键值配置，如 API Key）、共享状态（跨脚本数据存储，支持 CAS 乐观锁）、访问令牌（API 认证）、控制台凭证（浏览器会话 Token）和数据备份恢复。

## 配置值

路径：管理台 → 设置 → 配置值

### 数据模型

```java
public class ConfigValue {
    private String key;            // 唯一配置键名
    private String value;          // 配置值
    private boolean secret;        // 是否为敏感值（日志/UI 脱敏）
    private String description;
    private ConfigValueSource source;  // MANUAL / REPOSITORY_DEFAULT
    // 仓库默认值相关
    private String repositoryId;
    private String repositoryDefaultValue;
}
```

### 配置值的作用

配置值主要用于：

1. **存储 AI 模型的 API Key**（模型配置通过 Key 名引用）
2. **Webhook的 HMAC 密钥**（`secretConfigKey` 字段引用）
3. **任何需要全局管理的配置**（如数据库连接字符串）

### 创建/编辑

| 字段 | 说明 | 示例 |
|------|------|------|
| Key | 唯一配置键名 | `ai.openai.key` |
| Value | 配置值 | `sk-xxxxxxxxxxxxxxxx` |
| 描述 | 配置用途说明 | `OpenAI API Key` |
| Secret | 标记为敏感值 | 勾选（日志和 UI 中自动脱敏显示为 `*****`） |

### 配置值详情页

**概览标签页：**
- 键名、值（Secret 类型脱敏显示）、描述、Secret 标记
- 创建时间和更新时间
- 来源（手动创建 / 仓库默认值）

**影响标签页：**
反向依赖分析——显示此配置值被哪些脚本和资源引用。

**仓库默认值：**
如果配置值来源于仓库默认值，提供：
- 复制为本地覆盖：基于仓库默认值创建本地可编辑的版本
- 恢复仓库默认值：放弃本地修改，回到仓库默认值

### REST API

```bash
# CRUD
GET    /api/config-values
POST   /api/config-values
GET    /api/config-values/{key}
PUT    /api/config-values/{key}
DELETE /api/config-values/{key}

# 影响分析
GET    /api/config-values/{key}/impacts
```

## 共享状态

路径：管理台 → 设置 → 共享状态

### 一句话理解

共享状态是跨脚本的键值存储。不同脚本可以通过命名空间隔离存储数据，支持乐观锁（CAS）保证并发安全，自动追踪写入者信息。

### 数据模型

```java
public class SharedStateEntry {
    private String id;
    private String namespace;     // 命名空间，用于隔离不同脚本的数据
    private String key;           // 状态键名
    private String value;         // JSON 格式的值
    private int version;          // 版本号（CAS 乐观锁）
    private boolean secret;       // 敏感值标记
    private LocalDateTime expiresAt;  // 过期时间
    private String lastWriterScriptId;      // 最后写入脚本 ID
    private String lastWriterExecutionId;   // 最后写入执行 ID
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

### 特性

| 特性 | 说明 |
|------|------|
| 命名空间隔离 | `namespace + key` 双主键，不同脚本按 namespace 隔离 |
| Secret 标记 | 标记为敏感值后，日志和 UI 中自动脱敏 |
| TTL 过期 | 设置 `expiresAt` 后自动清理过期条目 |
| 版本号 + CAS | `version` 作为乐观锁，`state.cas()` 要求传入当前版本号 |
| 自动追踪 | 自动记录最后写入的脚本 ID 和执行 ID |

### 命名空间浏览器

切换不同命名空间查看该空间下的所有状态条目。

### 表格列

| 列 | 说明 |
|----|------|
| Key | 状态键名 |
| Value 预览 | 值的摘要（Secret 类型脱敏为 `*****`） |
| 版本 | 当前版本号 |
| Secret | 是否为敏感值 |
| 过期时间 | TTL 到期时间 |
| 最后写入者 | 最后修改的脚本名称和执行 ID |

### 操作

| 操作 | 说明 |
|------|------|
| 创建条目 | 填写 namespace、key、value（JSON 编辑器） |
| 更新条目 | 编辑已有条目 |
| CAS 更新 | 传入当前版本号，版本匹配才更新（并发安全） |
| 清理过期 | 一键清理所有已过期的条目 |
| 复制代码片段 | 自动生成 Groovy/Python/CLI 格式的 `state.get()`、`state.put()` 代码 |

### 在脚本中操作共享状态

```groovy
// Groovy - 读取
def myData = state.get("my-namespace", "my-key")

// Groovy - 写入（覆盖）
state.put("my-namespace", "my-key", [count: 42])

// Groovy - CAS 更新（期望当前 version = 3）
state.cas("my-namespace", "my-key", [count: 43], 3)

// Groovy - 列出命名空间下所有条目
def allEntries = state.list("my-namespace")

// Groovy - 删除
state.delete("my-namespace", "my-key")
```

```python
# Python - 读取
value = state.get("my-namespace", "my-key")

# Python - 写入
state.put("my-namespace", "my-key", {"count": 42})

# Python - 列出
entries = state.list("my-namespace")
```

### CAS 乐观锁机制说明

CAS（Compare-And-Swap）用于防止并发写入冲突：

```
1. 脚本 A 读取 → version = 3, value = {count: 42}
2. 脚本 B 读取 → version = 3, value = {count: 42}
3. 脚本 A 写入: cas("ns", "key", {count: 43}, 3) → 成功, version → 4
4. 脚本 B 写入: cas("ns", "key", {count: 99}, 3) → 失败! (当前 version 是 4)
5. 脚本 B 重新读取 → version = 4, 重新计算后写入
```

### REST API

```bash
GET    /api/shared-state?namespace=my-ns        # 列出命名空间下所有条目
GET    /api/shared-state?namespace=my-ns&key=my-key  # 查询单个条目
PUT    /api/shared-state?namespace=my-ns&key=my-key   # 更新条目
DELETE /api/shared-state?namespace=my-ns&key=my-key   # 删除条目
```

## 访问令牌

路径：管理台 → 设置 → 访问令牌

### 一句话理解

访问令牌是 API 调用的 Bearer Token。没有配置任何令牌时，ActionDock 的 API 默认开放（适合本地开发）。配置了令牌后，API 请求必须携带 `Authorization: Bearer <token>` 头。

### 数据模型

```java
public class ApiAccessToken {
    private String id;           // 令牌 ID
    private String name;         // 令牌名称
    private String tokenValue;   // 令牌值
    private boolean enabled;     // 是否启用
    private LocalDateTime createdAt;
}
```

### 表格列

| 列 | 说明 |
|----|------|
| Token ID | 令牌标识 |
| 名称 | 人类可读名称（如 `开发环境`、`CI 管道`） |
| Token 值 | 脱敏显示，提供复制按钮 |
| 启用状态 | 是否启用 |
| 创建时间 | 创建时间戳 |

### 操作

| 操作 | 说明 |
|------|------|
| 创建令牌 | 生成新的 Token（创建后只显示一次，请妥善保存） |
| 启用/禁用 | 切换令牌状态 |
| 删除令牌 | 永久删除 |
| 设为控制台凭证 | 快速将 Token 复制到浏览器会话中 |

### REST API

```bash
GET    /api/access-tokens
POST   /api/access-tokens
GET    /api/access-tokens/{id}
PUT    /api/access-tokens/{id}
DELETE /api/access-tokens/{id}

POST   /api/access-tokens/{id}/enable
POST   /api/access-tokens/{id}/disable
```

## 控制台凭证

路径：管理台 → 设置 → 控制台凭证

管理台前端本身使用浏览器会话。当 API 有 Bearer Token 认证时，前端也需要配置 Token 才能在管理台页面中正常操作。

- 输入 Token 后保存到浏览器本地存储
- 状态指示器显示是否已配置
- 清除凭证按钮

**注意：** 如果没有配置任何访问令牌，所有 API 请求不需要认证（开放模式），管理台也不需要配置控制台凭证。

## 数据备份与恢复

路径：管理台 → 设置 → 数据备份

### 创建备份

1. 概览表格显示各类型数据量：脚本、调度、Webhook、配置值、执行预设、仓库、插件、共享状态、AI 模型、AI Agent、AI Toolset、Skill 目标、Skills
2. 可勾选「包含 Secret 配置值和共享状态明文值」
3. 点击「创建备份」下载 `.zip` 文件

**备份文件结构：**

```text
backup-20260506.zip
├── backup.json           # 所有结构化数据
├── plugins/              # 插件 JAR 文件（可选）
└── skills/               # Skill 文件（可选）
```

### 恢复备份

1. 注意：恢复操作会覆盖现有数据——相同 ID 的记录将被覆盖
2. 上传 `.zip` 备份文件
3. 预览弹窗分析：每种数据类型将创建多少、覆盖多少
4. 确认后执行恢复
5. 结果摘要：每种数据类型的成功/跳过/失败计数及错误详情

### REST API

```bash
# 收集备份数据
POST /api/backup/collect?includeSecrets=true

# 执行恢复
POST /api/backup/restore
```

## 常见问题

### Q: Secret 配置值显示为 *****

这是正常的安全行为。Secret 类型的配置值在所有接口和 UI 中都脱敏显示。

### Q: CAS 更新失败

如果 `state.cas()` 返回错误，说明你传入的版本号不是当前最新版本。重新读取最新值，在新值基础上重试。

### Q: 共享状态过期了怎么处理

过期条目在读取时自动失效。可以使用「清理过期」按钮批量清理过期间条目。

### Q: 访问令牌丢了怎么办

无法找回 Token 值（安全设计）。删除旧令牌，创建新令牌。

### Q: 备份恢复时报冲突

说明一些数据已经存在。恢复操作会覆盖已有数据。

## 最佳实践

- **API Key 安全第一**：AI 模型和Webhook的密钥始终通过 Config Value 管理，勾选 Secret
- **共享状态命名空间**：每个业务模块使用独立的 namespace，避免键名冲突
- **CAS 用于并发写**：多脚本同时修改同一条共享状态时，使用 CAS 保证原子性
- **多个访问令牌**：为不同用途创建不同令牌（开发、测试、生产），可以独立启用/禁用
- **定期备份**：重大变更前后备份一次

---

> [返回目录](user-manual.md) | 下一步：查看 [脚本编写指南](script-writing-guide.md)
