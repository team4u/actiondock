# 定时任务管理

创建、查看、更新和删除定时任务。覆盖 `schedule` 命令。

定时任务允许脚本按 cron 表达式自动周期执行。cron 格式为 **Spring 6 位**：`秒 分 时 日 月 周`（比标准 Unix cron 多了秒位）。

---

## 创建定时任务

简单参数可直传 flag：

```bash
actiondock schedule create \
  --script-id <script-id> \
  --schedule-name "每日同步" \
  --schedule-cron "0 0 9 * * *" \
  --name alice
```

复杂输入优先写入临时文件再传参：

```bash
echo '{"name":"alice","config":{"timeout":30}}' > /tmp/schedule-input.json

actiondock schedule create \
  --script-id <script-id> \
  --schedule-name "每日同步" \
  --schedule-cron "0 0 9 * * *" \
  --input-file /tmp/schedule-input.json
```

支持 `--input-json` / `--input-file` 和动态 flag 传参，与 `script run` 相同。

加 `--schedule-disabled` 创建时即禁用（默认启用）。

---

## 列出定时任务

```bash
actiondock schedule list
```

可按脚本过滤：

```bash
actiondock schedule list --script-id <script-id>
```

---

## 查看定时任务详情

```bash
actiondock schedule get <schedule-id>
```

显示 cron 表达式、下次执行时间、上次执行状态、输入参数等。

---

## 更新定时任务

```bash
actiondock schedule update <schedule-id> \
  --schedule-cron "0 0 8 * * 1-5"
```

可更新：`--schedule-name`、`--schedule-cron`、输入参数。
`--replace-input`：替换已有输入（默认合并）。

---

## 启用 / 禁用 / 删除

```bash
actiondock schedule enable <schedule-id>
actiondock schedule disable <schedule-id>
actiondock schedule delete <schedule-id>
```

---

## 典型工作流

### 设置每日定时执行

```bash
actiondock schedule create \
  --script-id daily-report \
  --schedule-name "每日报告" \
  --schedule-cron "0 0 9 * * *" \
  --input-file ./daily-input.json
```

### 查看定时任务执行历史

```bash
actiondock execution list --schedule-id <schedule-id>
```
