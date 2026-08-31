# 实践指南：多环境 Profile 与远程调度 (Profiles Guide)

**Execution Profile** 机制允许开发者在本地终端中无缝管理多个远端 ActionDock 云节点，实现跨开发、测试与生产环境的调度。

---

## Profile 管理命令

### 添加远程 Profile
```bash
# 使用固定 Token
ac profile add staging --endpoint http://10.0.0.12:8080 --token secret-token-123

# 使用环境变量引用（更安全，推荐）
ac profile add prod --endpoint https://actiondock.internal.company.com --token-env PROD_ACTIONDOCK_TOKEN
```

### 查看与切换 Profile
```bash
# 列出所有配置的 Profile
ac profile list

# 设为默认 Profile
ac profile use staging

# 删除 Profile
ac profile remove old-env
```

---

## 跨节点远程执行

在执行命令时传入 `--profile` 参数，CLI 会自动将请求转发给远端 `ac serve` 节点执行：

```bash
# 在 staging 节点执行 Action
ac run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}' --profile staging

# 查询 remote 节点的健康状态与 Action 清单
ac info --profile prod
```

---

## 安全加固保证

- **文件权限保护**：Profile 配置文件 `~/.actiondock/profiles.json` 写入时强制设置 `0o600` 文件权限（仅当前系统用户可读写）。
- **支持 `tokenEnv`**：避免在配置文件中明文保存高权限敏感 Token。
