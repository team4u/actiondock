# 共享状态管理

脚本间/执行间的持久化数据，用于跨执行传递信息。CLI 命令先遵守 `references/common.md`。

---

## 脚本内 API（`state` 门面）

脚本运行时内置 `state` 对象，可在 Groovy/Python 脚本中直接调用。

### Groovy

```groovy
// 读取（返回值是一个 Map，不是纯字符串）
def entry = state.get("namespace", "key")
def value = entry?.value   // 实际值
def version = entry?.version  // 版本号

// 写入（无额外选项）
state.put("namespace", "key", value)

// 写入（带选项 Map）
state.put("namespace", "key", value, [secret: true, expires_in_seconds: 14400])
```

### Python

```python
# 读取
entry = state.get("namespace", "key")
value = entry.get("value") if entry else None

# 写入（无额外选项）
state.put("namespace", "key", value)

# 写入（带选项）
state.put("namespace", "key", value, secret=True, expires_in_seconds=14400)
```

### 说明

- `state.get(namespace, key)` 返回 **对象/Map**，含字段：`key`、`value`、`secret`、`version`、`expiresAt`、`createdAt`。**不是纯字符串**，需通过 `.value` 获取实际值。
- `state.put(namespace, key, value)` 第三个参数起，Groovy 要用 **Map 字面量** `[secret: true, ...]`，Python 用关键字参数。
- 选项支持：
  | 参数 | 类型 | 说明 |
  |------|------|------|
  | `secret` | `boolean` | 标记为敏感数据，加密存储 |
  | `expires_in_seconds` | `int` | 相对过期时间（秒） |
  | `expires_at` | `string` | 绝对过期时间（ISO 8601） |

---

## CLI 命令

## 列出命名空间

```bash
actiondock state namespaces --json
```

---

## 列出命名空间下的条目

```bash
actiondock state list <namespace> --json
```

---

## 查看条目详情

```bash
actiondock state get <namespace> <key> --json
```

---

## 创建/更新条目

```bash
actiondock state put <namespace> <key> \
  --value-json '{"count": 1}' \
  --expires-at 2026-12-31T23:59:59 \
  --json
```

加 `--secret` 标记为敏感数据，加 `--expires-at` 设置过期时间。

---

## 乐观锁更新（CAS）

```bash
actiondock state cas <namespace> <key> \
  --expected-version 3 \
  --value-json '{"count": 2}' \
  --json
```

只有当前版本号匹配 `--expected-version` 时才更新成功，用于并发安全。

---

## 删除条目

```bash
actiondock state delete <namespace> <key> --json
```

---

## 清理过期条目

```bash
actiondock state purge-expired --json              # 清理全部命名空间的过期条目
actiondock state purge-expired <namespace> --json  # 清理指定命名空间
```
