# 执行历史管理

查看、删除和清理脚本的执行记录。覆盖 `execution` 命令。

---

## 查看单条执行记录

```bash
actiondock execution get <execution-id>
```

关注字段：
- `status`：执行状态（SUCCEEDED / FAILED / RUNNING）
- `output`：脚本输出结果
- `errorMessage` / `errorDetail`：失败时的错误信息
- `logs`：脚本日志

---

## 列出执行历史

```bash
actiondock execution list --script-id <script-id>
```

**必须**提供 `--script-id` 或 `--schedule-id` 之一。

按定时任务过滤：

```bash
actiondock execution list --schedule-id <schedule-id>
```

---

## 删除执行记录

```bash
actiondock execution delete <execution-id>
```

---

## 清空执行记录

清空指定脚本的执行记录：

```bash
actiondock execution clear --script-id <script-id>
```

清空全部执行记录（不加 `--script-id`）：

```bash
actiondock execution clear
```
