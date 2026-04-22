# scriptflow-cli

ScriptFlow 官方薄封装 CLI：

- 只调用现有 Web API
- 不嵌入脚本运行时
- 默认输出 JSON envelope
- 支持 flag、环境变量和本地 profile 组合管理连接配置

## 构建

```bash
mvn -pl scriptflow-cli -am package
```

## 连接配置

配置优先级（高到低）：命令行 flag > 环境变量 > 本地 profile

| 配置项 | CLI Flag | 环境变量 | 说明 |
|--------|----------|----------|------|
| 服务地址 | `--base-url` | `SF_BASE_URL` | 例如 `http://localhost:8080` |
| 认证令牌 | `--token` | `SF_TOKEN` | Bearer token |
| 连接超时 | `--connect-timeout-ms` | `SF_CONNECT_TIMEOUT_MS` | HTTP 连接超时（毫秒） |
| 读超时 | `--read-timeout-ms` | `SF_READ_TIMEOUT_MS` | HTTP 读超时（毫秒） |

## 命令总览

```
scriptflow-cli <command> <subcommand> [options]
```

| 命令 | 说明 |
|------|------|
| [config](#config-配置管理) | 连接配置和 profile 管理 |
| [scripts](#scripts-脚本管理) | 脚本草稿、发布版本和执行 |
| [executions](#executions-执行记录) | 执行记录的提交、查询和清理 |
| [schedules](#schedules-定时任务) | 定时任务的查询和维护 |
| [plugins](#plugins-插件管理) | 插件的安装、生命周期和调用 |

---

## config 配置管理

### config current

显示最终生效的连接配置，包括值来源、token 是否存在和配置文件路径。

```bash
java -jar scriptflow-cli.jar config current
```

### config profile list

列出所有本地 profile 名称和当前 profile。

```bash
java -jar scriptflow-cli.jar config profile list
```

### config profile get

查看单个本地 profile 的配置。

```bash
java -jar scriptflow-cli.jar config profile get <profileName>
```

### config profile set

创建或更新一个本地 profile，并将其设为当前 profile。未提供的选项会保留该 profile 现有值。

```bash
# 创建 dev profile
java -jar scriptflow-cli.jar config profile set dev \
  --base-url http://localhost:8080 \
  --token dev-token

# 只更新 token
java -jar scriptflow-cli.jar config profile set dev --token new-token
```

### config profile delete

删除本地 profile。如果删除的是当前 profile，则 currentProfile 会被清空。

```bash
java -jar scriptflow-cli.jar config profile delete <profileName>
```

---

## scripts 脚本管理

### scripts list

列出脚本草稿列表。

```bash
java -jar scriptflow-cli.jar scripts list
```

### scripts get

获取指定脚本当前保存的定义。如果脚本已有未发布修改，返回的是当前草稿内容。

```bash
java -jar scriptflow-cli.jar scripts get <scriptId>
```

### scripts get-published

获取指定脚本当前已发布版本的详情。如果脚本尚未发布，服务端会报错。

```bash
java -jar scriptflow-cli.jar scripts get-published <scriptId>
```

### scripts schema

获取指定脚本当前定义中的输入/输出 schema 摘要。

```bash
java -jar scriptflow-cli.jar scripts schema <scriptId>
```

### scripts create

创建脚本草稿。`--file` 必须提供脚本定义 JSON 文件。

```bash
# 从文件创建
java -jar scriptflow-cli.jar scripts create --file script.json

# 从 stdin 读取
cat script.json | java -jar scriptflow-cli.jar scripts create --file -
```

### scripts update

更新指定脚本的草稿定义。`--file` 必须提供完整脚本定义 JSON。

```bash
java -jar scriptflow-cli.jar scripts update <scriptId> --file script.json
```

### scripts delete

删除指定脚本。

```bash
java -jar scriptflow-cli.jar scripts delete <scriptId>
```

### scripts validate

校验指定脚本当前保存定义是否可执行，不会发布脚本。

```bash
java -jar scriptflow-cli.jar scripts validate <scriptId>
```

### scripts publish

发布指定脚本当前保存的定义。服务端会把当前定义保存为 published snapshot，并将版本号加 1。

```bash
java -jar scriptflow-cli.jar scripts publish <scriptId>
```

### scripts discard-draft

丢弃指定脚本当前未发布修改，恢复为已发布快照。要求脚本已经存在已发布版本。

```bash
java -jar scriptflow-cli.jar scripts discard-draft <scriptId>
```

### scripts execute-published

执行指定脚本的已发布版本。不会使用当前未发布修改。

```bash
# 同步执行，返回结果
java -jar scriptflow-cli.jar scripts execute-published <scriptId> \
  --input '{"name":"Alice"}'

# 异步提交并等待执行完成
java -jar scriptflow-cli.jar scripts execute-published <scriptId> \
  --input '{"name":"Bob"}' \
  --wait \
  --wait-timeout-seconds 60

# 从文件读取输入
java -jar scriptflow-cli.jar scripts execute-published <scriptId> \
  --input-file input.json

# 指定返回视图
java -jar scriptflow-cli.jar scripts execute-published <scriptId> \
  --response-view DEBUG
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--input` | `{}` | 内联执行入参 JSON |
| `--input-file` | - | 执行入参 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--mode` | `SYNC` | 提交模式：`SYNC` 或 `ASYNC` |
| `--response-view` | `RESULT` | 返回视图：`RESULT` 或 `DEBUG` |
| `--wait` | false | 提交后等待执行结束 |
| `--wait-timeout-seconds` | 30 | 等待超时时间（秒） |
| `--poll-interval-ms` | 1000 | 轮询间隔（毫秒） |

---

## executions 执行记录

### executions submit

提交一次脚本执行。执行的是当前脚本定义，不要求脚本已发布。

```bash
# 基本用法
java -jar scriptflow-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Alice"}'

# 异步提交并等待
java -jar scriptflow-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Bob"}' \
  --wait

# 自定义超时
java -jar scriptflow-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Carol"}' \
  --wait \
  --wait-timeout-seconds 120
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--script-id` | 必填 | 要执行的脚本 ID |
| `--input` | `{}` | 内联执行入参 JSON |
| `--input-file` | - | 执行入参 JSON 文件路径 |
| `--mode` | `SYNC` | 提交模式：`SYNC` 或 `ASYNC` |
| `--response-view` | `RESULT` | 返回视图：`RESULT` 或 `DEBUG` |
| `--wait` | false | 提交后等待执行结束 |
| `--wait-timeout-seconds` | 30 | 等待超时时间（秒） |
| `--poll-interval-ms` | 1000 | 轮询间隔（毫秒） |

### executions get

获取单次执行的详情。

```bash
java -jar scriptflow-cli.jar executions get <executionId>
```

### executions list

列出执行记录。

```bash
# 列出全部
java -jar scriptflow-cli.jar executions list

# 只看某个脚本的执行历史
java -jar scriptflow-cli.jar executions list --script-id hello-groovy
```

### executions delete

删除单条执行记录。

```bash
java -jar scriptflow-cli.jar executions delete <executionId>
```

### executions clear

按脚本清空执行记录。服务端要求必须提供 `--script-id`。

```bash
java -jar scriptflow-cli.jar executions clear --script-id hello-groovy
```

---

## schedules 定时任务

### schedules list

列出定时任务。

```bash
# 列出全部
java -jar scriptflow-cli.jar schedules list

# 只列出某脚本下的定时任务
java -jar scriptflow-cli.jar schedules list --script-id hello-groovy
```

### schedules get

获取单个定时任务详情。

```bash
java -jar scriptflow-cli.jar schedules get <scheduleId>
```

### schedules create

创建定时任务。

```bash
# 从文件创建
java -jar scriptflow-cli.jar schedules create --file schedule.json

# 从 stdin 读取
cat schedule.json | java -jar scriptflow-cli.jar schedules create --file -
```

定时任务 JSON 示例：

```json
{
  "scriptId": "hello-groovy",
  "name": "每日问候",
  "cronExpression": "0 0 9 * * ?",
  "input": {"name": "Alice"},
  "enabled": true
}
```

### schedules update

更新指定定时任务。服务端不允许借此把定时任务改挂到别的脚本上。

```bash
java -jar scriptflow-cli.jar schedules update <scheduleId> --file schedule.json
```

### schedules enable

启用指定定时任务。

```bash
java -jar scriptflow-cli.jar schedules enable <scheduleId>
```

### schedules disable

停用指定定时任务。

```bash
java -jar scriptflow-cli.jar schedules disable <scheduleId>
```

### schedules delete

删除指定定时任务。

```bash
java -jar scriptflow-cli.jar schedules delete <scheduleId>
```

---

## plugins 插件管理

### plugins list

列出已安装插件。

```bash
java -jar scriptflow-cli.jar plugins list
```

### plugins get

获取单个插件详情。

```bash
java -jar scriptflow-cli.jar plugins get <pluginId>
```

### plugins install

上传并安装插件 JAR 包。

```bash
java -jar scriptflow-cli.jar plugins install --jar plugin.jar
```

### plugins upgrade

使用新的插件 JAR 升级指定插件。

```bash
java -jar scriptflow-cli.jar plugins upgrade <pluginId> --jar new-plugin.jar
```

### plugins start

启动指定插件。

```bash
java -jar scriptflow-cli.jar plugins start <pluginId>
```

### plugins stop

停止指定插件。

```bash
java -jar scriptflow-cli.jar plugins stop <pluginId>
```

### plugins delete

删除指定插件。

```bash
java -jar scriptflow-cli.jar plugins delete <pluginId>
```

### plugins invoke

调用插件的某个 action。

```bash
# 基本调用
java -jar scriptflow-cli.jar plugins invoke <pluginId> <action>

# 带参数调用
java -jar scriptflow-cli.jar plugins invoke <pluginId> <action> \
  --args '{"key":"value"}'

# 带脚本输入上下文
java -jar scriptflow-cli.jar plugins invoke <pluginId> <action> \
  --args '{"key":"value"}' \
  --script-input '{"scriptInputKey":"scriptInputValue"}'

# 返回调试信息
java -jar scriptflow-cli.jar plugins invoke <pluginId> <action> \
  --response-view DEBUG
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--args` | `{}` | 内联 action 参数 JSON |
| `--args-file` | - | action 参数 JSON 文件路径 |
| `--script-input` | `{}` | 内联脚本输入上下文 JSON |
| `--script-input-file` | - | 脚本输入上下文 JSON 文件路径 |
| `--response-view` | `RESULT` | 返回视图：`RESULT` 或 `DEBUG` |

### plugins config get

获取插件配置。

```bash
java -jar scriptflow-cli.jar plugins config get <pluginId>
```

### plugins config set

更新插件配置。

```bash
# 从文件设置
java -jar scriptflow-cli.jar plugins config set <pluginId> --file config.json

# 从 stdin 读取
cat config.json | java -jar scriptflow-cli.jar plugins config set <pluginId> --file -
```

配置 JSON 示例（顶层需要包含 `config` 字段）：

```json
{
  "config": {
    "settingKey": "settingValue"
  }
}
```

---

## 示例

```bash
# 查看当前配置
java -jar scriptflow-cli.jar config current

# 使用指定配置执行
java -jar scriptflow-cli.jar \
  --base-url http://localhost:8080 \
  --token local-dev-key \
  scripts list

# 提交执行并等待结果
java -jar scriptflow-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Alice"}' \
  --wait
```
