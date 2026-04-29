# 共享状态管理

脚本间/执行间的持久化数据，用于跨执行传递信息。覆盖 `state` 命令。

---

## 列出命名空间

```bash
actiondock state namespaces
```

---

## 列出命名空间下的条目

```bash
actiondock state list <namespace>
```

---

## 查看条目详情

```bash
actiondock state get <namespace> <key>
```

---

## 创建/更新条目

```bash
actiondock state put <namespace> <key> \
  --value-json '{"count": 1}' \
  --expires-at 2026-12-31T23:59:59
```

加 `--secret` 标记为敏感数据，加 `--expires-at` 设置过期时间。

---

## 乐观锁更新（CAS）

```bash
actiondock state cas <namespace> <key> \
  --expected-version 3 \
  --value-json '{"count": 2}'
```

只有当前版本号匹配 `--expected-version` 时才更新成功，用于并发安全。

---

## 删除条目

```bash
actiondock state delete <namespace> <key>
```

---

## 清理过期条目

```bash
actiondock state purge-expired              # 清理全部命名空间的过期条目
actiondock state purge-expired <namespace>  # 清理指定命名空间
```
