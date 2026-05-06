访问令牌（Access Token）是 ScriptFlow 系统用于 API 认证的核心安全机制。通过 Bearer Token 认证方式，系统为每个客户端或环境生成唯一的令牌，实现对 API 资源的精细化访问控制。

## 核心概念

ScriptFlow 采用**令牌哈希存储**的安全设计。服务端仅存储令牌的 SHA-256 哈希值，而非明文令牌。当客户端请求携带令牌时，系统通过常量时间比较算法验证哈希值是否匹配，从而防止时序攻击。

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant Filter as ApiKeyAuthFilter
    participant Service as ApiAccessTokenApplicationService
    participant Repository as ApiAccessTokenRepository
    
    Client->>Filter: 请求 /api/* + Authorization: Bearer adk_xxx
    Filter->>Service: authenticate(token)
    Service->>Repository: findById(id)
    Repository-->>Service: ApiAccessToken
    Service->>Service: SHA-256(rawToken) vs tokenHash
    Service->>Repository: save(updated lastUsedAt)
    Service-->>Filter: true/false
    Filter-->>Client: 200 OK / 401 Unauthorized
```

### 令牌格式规范

系统生成的令牌遵循特定格式：`adk_{id}_{secret}`，其中 ID 为 32 位十六进制字符串，Secret 为 64 位十六进制随机字符串。预览显示仅展示后 8 位字符，例如 `****a1b2c3d4`。

| 属性 | 说明 |
|------|------|
| 前缀 | `adk_` 标识 ActionDock 令牌 |
| ID 部分 | UUID 去掉连字符，长度 32 |
| Secret 部分 | 双倍 UUID 随机值，长度 64 |
| 预览格式 | `****` + 后 8 位字符 |

Sources: [ApiAccessTokenApplicationService.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/application/ApiAccessTokenApplicationService.java#L21-L53)

## 生命周期管理

### 创建令牌

创建新令牌时，系统执行以下操作：

1. 生成唯一 32 位 ID
2. 生成 64 位随机 Secret
3. 拼接完整令牌值 `adk_{id}_{secret}`
4. 计算 SHA-256 哈希并存储
5. 构建预览字符串 `****{尾部8位}`

**重要提示**：完整令牌值仅在创建时返回一次，之后无法恢复。请立即将令牌安全存储。

```typescript
// 前端类型定义
interface AccessToken {
  id: string;           // 令牌唯一标识
  name: string;         // 人类可读名称
  tokenPreview: string; // 脱敏预览
  enabled: boolean;     // 启用状态
  tokenValue?: string;  // 仅创建时返回
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;  // 最近使用时间
}
```

Sources: [AccessTokenManagementPage.tsx](actiondock-admin-ui/src/pages/AccessTokenManagementPage.tsx#L102-L134)

### 启用与禁用

令牌支持热切换启用状态。禁用后，令牌立即失效，持有该令牌的客户端会收到 401 响应。禁用操作不会删除令牌数据，便于后续重新启用。

```java
public ApiAccessToken enable(String id) {
    return setEnabled(id, true);
}

public ApiAccessToken disable(String id) {
    return setEnabled(id, false);
}
```

Sources: [ApiAccessTokenApplicationService.java](actiondock-core/src/main/java/org/team4u/actiondock/application/ApiAccessTokenApplicationService.java#L63-L69)

### 删除令牌

删除为不可逆操作。删除后，持有该令牌的客户端会**立即**认证失败。建议在删除前确认所有使用该令牌的客户端已停止或切换到其他令牌。

```java
public void delete(String id) {
    requireExisting(id);
    repository.deleteById(normalizeId(id));
}
```

Sources: [ApiAccessTokenApplicationService.java](actiondock-core/src/main/java/org/team4u/actiondock/application/ApiAccessTokenApplicationService.java#L71-L74)

## 认证过滤器

`ApiKeyAuthFilter` 是 Spring Boot Servlet 过滤器，在 `/api/*` 路径上拦截所有请求进行认证验证。

```java
@Override
protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI();
    // 非 API 路径跳过认证
    // Webhook 事件接收端点跳过认证（由事件源单独认证）
    return !path.startsWith("/api/")
            || ("POST".equalsIgnoreCase(request.getMethod())
            && path.matches("^/api/event-sources/[^/]+/events$"));
}
```

Sources: [ApiKeyAuthFilter.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/auth/ApiKeyAuthFilter.java#L32-L38)

### 认证跳过条件

| 路径模式 | 方法 | 原因 |
|----------|------|------|
| 非 `/api/*` | 任意 | 前端静态资源 |
| `/api/event-sources/{id}/events` | POST | Webhook 事件接收，使用独立认证机制 |

### 开放模式

当系统中**不存在任何令牌**时（即 `hasAnyToken()` 返回 false），所有 API 请求直接放行，无需认证。此设计便于本地开发和测试环境快速上手。

Sources: [ApiKeyAuthFilter.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/auth/ApiKeyAuthFilter.java#L56-L59)

## 客户端集成

### Web 前端

前端使用 localStorage 存储当前会话的 Bearer Token。`tokenStore` 模块提供令牌存取和变更事件通知。

```typescript
// tokenStore.ts
const TOKEN_KEY = "actiondock-admin-access-token";

export function getApiKey(): string {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setApiKey(value: string): void {
    const normalized = value.trim();
    if (normalized) {
        window.localStorage.setItem(TOKEN_KEY, normalized);
    } else {
        window.localStorage.removeItem(TOKEN_KEY);
    }
    dispatch(TOKEN_CHANGE_EVENT);
}
```

Sources: [tokenStore.ts](actiondock-admin-ui/src/shared/auth/tokenStore.ts#L1-L30)

HTTP 客户端在每次请求时自动注入 Authorization 头：

```typescript
function buildHeaders(init?: RequestInit): Headers {
    const headers = new Headers(init?.headers ?? {});
    const token = getApiKey();
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
}
```

Sources: [httpClient.ts](actiondock-admin-ui/src/shared/api/httpClient.ts#L19-L29)

### CLI 工具

CLI 从三个来源按优先级获取令牌：

1. 命令行 `--token` 参数
2. 环境变量 `ACTIONDOCK_TOKEN`
3. 配置文件 `~/.config/actiondock/config.json`

```typescript
export function resolveToken(flagValue: string | undefined): string | undefined {
    const token = flagValue ?? process.env.ACTIONDOCK_TOKEN ?? readConfig().token;
    return token?.trim() ? token.trim() : undefined;
}
```

Sources: [config.ts](actiondock-cli/src/lib/config.ts#L68-L71)

### cURL 示例

```bash
# 创建令牌后，使用令牌调用 API
curl -X GET "http://localhost:5177/api/scripts" \
  -H "Authorization: Bearer adk_abc123def456_..."
```

## 最佳实践

### 令牌命名规范

使用描述性名称标识令牌用途和环境：

| 示例名称 | 用途 |
|----------|------|
| `本地开发-张三` | 个人开发环境 |
| `CI/CD-Jenkins` | 持续集成流水线 |
| `生产环境-API网关` | 外部系统对接 |
| `测试环境-自动化脚本` | 自动化测试 |

### 安全建议

1. **分离环境令牌**：每个环境（开发、测试、生产）使用独立令牌
2. **最小权限原则**：不同客户端使用不同令牌，便于权限管理和撤销
3. **定期轮换**：定期创建新令牌并废弃旧令牌
4. **安全存储**：令牌仅在创建时显示，请妥善保存到密码管理器
5. **禁用而非删除**：临时停用的令牌保留以便快速恢复

### 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| 401 Unauthorized | 令牌无效或已删除 | 检查令牌是否正确配置 |
| 401 Unauthorized | 令牌已禁用 | 在管理台启用令牌 |
| 401 Unauthorized | 令牌拼写错误 | 确认 Bearer 拼写正确，无多余空格 |
| 无需认证 | 系统中无令牌 | 创建第一个令牌后，其他客户端需要认证 |

## 相关文档

- [配置值管理](14-pei-zhi-zhi-guan-li) - 了解如何管理 API Key 等敏感配置
- [REST API 参考](19-rest-api-can-kao) - 查看完整的 API 端点文档
- [CLI 命令参考](18-cli-ming-ling-can-kao) - 了解 CLI 工具的 token 配置方式