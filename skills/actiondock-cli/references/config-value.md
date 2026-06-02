# 配置值管理

通过 ActionDock CLI 查询、创建、更新和删除平台配置值（ConfigValue）。配置值用于存储脚本运行时所需的参数，如 API 凭证、连接地址等键值对。

本文件只覆盖 `config value` 命令。先遵守 `references/common.md`。共享状态见 `state-management.md`。

---

## 列出配置值

```bash
actiondock config value list --json
```

```bash
actiondock config value list --intent "oa\." --json
```

---

## 查看单个配置值

```bash
actiondock config value get <key> --json
```

示例：

```bash
actiondock config value get 'oa.username' --json
```

关注字段：`key`、`value`、`description`、`secret`（是否加密存储）、`overrideType`（管理来源：本地覆盖或仓库默认）。

---

## 创建配置值

```bash
actiondock config value set <key> --value <value> --create --json
```

可选参数：

| 参数 | 说明 |
|------|------|
| `--description <text>` | 人类可读描述 |
| `--secret` | 标记为敏感数据，加密存储 |

示例：

```bash
actiondock config value set 'oa.password' --value 's3cret' --description 'OA 登录密码' --secret --create --json
```

---

## 更新配置值

```bash
actiondock config value set <key> --value <new-value> --json
```

不带 `--create` 时为更新模式（PUT）。

可选参数：

| 参数 | 说明 |
|------|------|
| `--value <text>` | 新值 |
| `--description <text>` | 更新描述 |
| `--secret` | 标记为敏感 |
| `--preserve-value` | 仅更新元数据（描述、secret 标记），保留当前值不变 |

---

## 删除配置值

```bash
actiondock config value delete <key> --json
```

---

## 复制为本地覆盖

将仓库管理的配置值复制为本地覆盖副本，之后可自由修改而不影响仓库默认值。

```bash
actiondock config value copy-local-override <key> --json
```

---

## 恢复仓库默认值

撤销本地覆盖，恢复为仓库原始默认值。

```bash
actiondock config value restore-repository-default <key> --json
```

---

## 常见场景

**查看脚本所需的全部配置项：**

```bash
actiondock config value list --intent "<scriptId>" --json
```

**批量设置 API 凭证：**

```bash
actiondock config value set 'external.api_key' --value '<key>' --secret --create --json
actiondock config value set 'external.api_url' --value 'https://api.example.com' --create --json
```

**仅更新描述，不改值：**

```bash
actiondock config value set 'oa.username' --description 'OA 系统登录账号' --preserve-value --json
```
