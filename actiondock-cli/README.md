# actiondock-cli

ActionDock 官方薄封装 CLI：

- 只调用现有 Web API
- 不嵌入脚本运行时
- 默认输出 JSON envelope
- 支持 flag、环境变量和本地 profile 组合管理连接配置

## 构建

```bash
mvn -pl actiondock-cli -am package
```

## jDeploy 打包与发布

在 `actiondock-cli/` 模块目录执行：

```bash
cd actiondock-cli
mvn -DskipTests package
npx jdeploy package
npm pack --dry-run
```

首次上传前需要先登录 npm：

```bash
npm login
npx jdeploy publish
```

发布后的全局命令名为：

```bash
actiondock --help
```

## 连接配置

配置优先级（高到低）：命令行 flag > 环境变量 > 本地 profile

| 配置项 | CLI Flag | 环境变量 | 说明 |
|--------|----------|----------|------|
| Profile | `--profile` | `ACTIONDOCK_PROFILE` | 本地 profile 名称 |
| 服务地址 | `--base-url` | `ACTIONDOCK_BASE_URL` | 例如 `http://localhost:8080` |
| 认证令牌 | `--token` | `ACTIONDOCK_TOKEN` | Bearer token |
| 连接超时 | `--connect-timeout-ms` | - | HTTP 连接超时（毫秒） |
| 读超时 | `--read-timeout-ms` | - | HTTP 读超时（毫秒） |

## 命令总览

```bash
actiondock <command> <subcommand> [options]
```

| 命令 | 说明 |
|------|------|
| [config](#config-配置管理) | 连接配置和 profile 管理 |
| [scripts](#scripts-脚本管理) | 脚本草稿、发布版本和执行 |
| [executions](#executions-执行记录) | 执行记录的提交、查询和清理 |
| [schedules](#schedules-定时任务) | 定时任务的查询和维护 |
| [plugins](#plugins-插件管理) | 插件的安装、生命周期和调用 |
| [config-values](#config-values-全局配置值) | 服务端全局配置值管理 |
| [access-tokens](#access-tokens-访问令牌) | 访问令牌的创建、启停和删除 |
| [repositories](#repositories-仓库和工具库) | 仓库、仓库工具和仓库插件管理 |
| [presets](#presets-执行参数预设) | 脚本执行参数预设管理 |
| [ai](#ai-ai-工作台和运行) | 模型、Agent、Toolset、AI Tool、Run 和 Workbench |
| [discover](#discover-agent-发现入口) | 输出机器可读的 CLI 能力树和推荐 Agent 流程 |

---

## Agent / LLM 使用协议

CLI 默认面向机器输出：成功和失败都使用 JSON envelope。

成功示例：

```json
{
  "status": 0,
  "msg": "Success",
  "data": {}
}
```

本地 CLI 参数错误会额外包含 `error` 字段，便于 Agent 修复后重试：

```json
{
  "status": 2,
  "msg": "--script-id is required unless --file is used",
  "data": null,
  "error": {
    "code": "MISSING_REQUIRED_OPTION",
    "command": "actiondock executions submit",
    "missing": ["--script-id"],
    "alternatives": ["--file"],
    "retryExamples": [
      "actiondock executions submit --script-id <scriptId> --input '{}'",
      "actiondock executions submit --file request.json"
    ]
  }
}
```

退出码约定：

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 2 | CLI 参数、互斥关系、JSON 或文件读取校验失败 |
| 3 | 本地配置或认证配置错误 |
| 4 | HTTP/网络传输错误 |
| 5 | 服务端业务错误 |
| 6 | 等待执行完成超时 |

### --help-json

任意命令都可以使用 `--help-json` 输出机器可读 help，不需要提供该命令原本的必填参数：

```bash
java -jar actiondock-cli.jar executions submit --help-json
java -jar actiondock-cli.jar scripts schema --help-json
```

输出示例：

```json
{
  "status": 0,
  "msg": "Success",
  "data": {
    "schemaVersion": "actiondock.cli.help.v1",
    "command": "actiondock executions submit",
    "purpose": "Submit a script execution against the current saved script definition.",
    "arguments": [],
    "options": [
      {
        "names": ["--input"],
        "type": "jsonObject",
        "required": false,
        "mutuallyExclusiveWith": ["--input-file", "--file"],
        "example": {"name": "Alice"}
      }
    ],
    "constraints": [],
    "defaults": {},
    "inputShapes": {},
    "outputShape": {},
    "examples": [],
    "exitCodes": {
      "0": "success",
      "2": "validation error",
      "3": "config error",
      "4": "transport error",
      "5": "business error",
      "6": "timeout"
    }
  }
}
```

### --dry-run / --validate-only

所有 REST 写操作支持：

| 选项 | 行为 |
|------|------|
| `--validate-only` | 只校验本地 CLI 参数、互斥关系、JSON object 和文件可读性；不创建 HTTP client，不读取连接配置，不调用服务端 |
| `--dry-run` | 构造最终 HTTP request preview 并输出；不调用服务端 |

两者互斥，同时使用会返回 `status=2` 和 `error.code=MUTUALLY_EXCLUSIVE_OPTIONS`。

该能力覆盖 `scripts`、`executions`、`schedules`、`plugins`、`config-values`、`repositories`、`access-tokens`、`ai` 下的 REST 写操作；`config profile set/delete` 是本地配置文件写入，不属于 REST 写操作。

示例：

```bash
java -jar actiondock-cli.jar executions submit \
  --script-id hello \
  --input '{"name":"Alice"}' \
  --validate-only

java -jar actiondock-cli.jar executions submit \
  --script-id hello \
  --input '{"name":"Alice"}' \
  --dry-run
```

`--dry-run` 输出示例：

```json
{
  "status": 0,
  "msg": "Dry run",
  "data": {
    "request": {
      "method": "POST",
      "path": "/api/executions",
      "query": {},
      "contentType": "application/json",
      "body": {
        "scriptId": "hello",
        "input": {"name": "Alice"},
        "mode": "SYNC",
        "responseView": "RESULT"
      }
    }
  }
}
```

Multipart 命令（如 `plugins install --jar`）的 dry-run 只输出文件名和大小，不输出文件内容。
下载命令（如 `plugins download --output demo.jar`）的 dry-run 只输出请求信息和目标文件路径，不会写本地文件。

### discover Agent 发现入口

```bash
java -jar actiondock-cli.jar discover
java -jar actiondock-cli.jar discover --json
```

输出当前 CLI 的能力树、Agent 特性和推荐流程：

```json
{
  "status": 0,
  "msg": "Success",
  "data": {
    "schemaVersion": "actiondock.cli.discover.v1",
    "defaultOutput": "json-envelope",
    "agentFeatures": ["--help-json", "--dry-run", "--validate-only", "scripts schema --example"],
    "commands": [],
    "recommendedFlows": [
      {
        "name": "execute script safely",
        "steps": [
          "actiondock scripts schema <scriptId> --example",
          "actiondock executions submit --script-id <scriptId> --input '<json>' --validate-only",
          "actiondock executions submit --script-id <scriptId> --input '<json>' --dry-run",
          "actiondock executions submit --script-id <scriptId> --input '<json>' --wait"
        ]
      }
    ]
  }
}
```

---

## config 配置管理

### config current

显示最终生效的连接配置，包括值来源、token 是否存在和配置文件路径。

```bash
java -jar actiondock-cli.jar config current
```

### config profile list

列出所有本地 profile 名称和当前 profile。

```bash
java -jar actiondock-cli.jar config profile list
```

### config profile get

查看单个本地 profile 的配置。

```bash
java -jar actiondock-cli.jar config profile get <profileName>
```

### config profile set

创建或更新一个本地 profile，并将其设为当前 profile。未提供的选项会保留该 profile 现有值。

```bash
# 创建 dev profile
java -jar actiondock-cli.jar config profile set dev \
  --base-url http://localhost:8080 \
  --token dev-token

# 只更新 token
java -jar actiondock-cli.jar config profile set dev --token new-token
```

### config profile delete

删除本地 profile。如果删除的是当前 profile，则 currentProfile 会被清空。

```bash
java -jar actiondock-cli.jar config profile delete <profileName>
```

---

## scripts 脚本管理

### scripts list

列出脚本草稿列表。

```bash
java -jar actiondock-cli.jar scripts list
```

### scripts get

获取指定脚本当前保存的定义。如果脚本已有未发布修改，返回的是当前草稿内容。

```bash
java -jar actiondock-cli.jar scripts get <scriptId>
```

### scripts get-published

获取指定脚本当前已发布版本的详情。如果脚本尚未发布，服务端会报错。

```bash
java -jar actiondock-cli.jar scripts get-published <scriptId>
```

### scripts schema

获取指定脚本当前定义中的输入/输出 schema 摘要。

```bash
java -jar actiondock-cli.jar scripts schema <scriptId>
java -jar actiondock-cli.jar scripts schema <scriptId> --example
```

`--example` 会返回原始 `inputSchema` / `outputSchema`，并根据 schema 的 `examples`、`default`、`enum` 和字段类型生成 `inputExample` / `outputExample`，适合 Agent 在执行前构造入参。

输出示例：

```json
{
  "status": 0,
  "msg": "Success",
  "data": {
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {"type": "string", "examples": ["Alice"]},
        "limit": {"type": "integer", "default": 10}
      },
      "required": ["name"]
    },
    "inputExample": {
      "name": "Alice",
      "limit": 10
    },
    "outputSchema": {},
    "outputExample": {},
    "notes": [
      "Only send fields declared in inputSchema unless the script explicitly supports extra fields."
    ]
  }
}
```

### scripts create

创建脚本草稿。`--file` 必须提供脚本定义 JSON 文件。

```bash
# 从文件创建
java -jar actiondock-cli.jar scripts create --file script.json

# 从 stdin 读取
cat script.json | java -jar actiondock-cli.jar scripts create --file -

# 只校验本地 JSON，不调用服务端
java -jar actiondock-cli.jar scripts create --file script.json --validate-only

# 预览最终 HTTP 请求，不调用服务端
java -jar actiondock-cli.jar scripts create --file script.json --dry-run
```

脚本定义 JSON 最小示例：

```json
{
  "id": "hello",
  "name": "Hello",
  "type": "GROOVY",
  "source": "return [ok:true]",
  "inputSchema": {
    "type": "object",
    "properties": {}
  },
  "outputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

### scripts update

更新指定脚本的草稿定义。`--file` 必须提供完整脚本定义 JSON。

```bash
java -jar actiondock-cli.jar scripts update <scriptId> --file script.json
java -jar actiondock-cli.jar scripts update <scriptId> --file script.json --dry-run
```

### scripts delete

删除指定脚本。

```bash
java -jar actiondock-cli.jar scripts delete <scriptId>
java -jar actiondock-cli.jar scripts delete <scriptId> --dry-run
```

### scripts validate

校验指定脚本当前保存定义是否可执行，不会发布脚本。

```bash
java -jar actiondock-cli.jar scripts validate <scriptId>
java -jar actiondock-cli.jar scripts validate <scriptId> --dry-run
```

### scripts publish

发布指定脚本当前保存的定义。服务端会把当前定义保存为 published snapshot，并将版本号加 1。

```bash
java -jar actiondock-cli.jar scripts publish <scriptId>
java -jar actiondock-cli.jar scripts publish <scriptId> --dry-run
```

### scripts discard-draft

丢弃指定脚本当前未发布修改，恢复为已发布快照。要求脚本已经存在已发布版本。

```bash
java -jar actiondock-cli.jar scripts discard-draft <scriptId>
java -jar actiondock-cli.jar scripts discard-draft <scriptId> --dry-run
```

### scripts execute-published

执行指定脚本的已发布版本。不会使用当前未发布修改。

```bash
# 同步执行，返回结果
java -jar actiondock-cli.jar scripts execute-published <scriptId> \
  --input '{"name":"Alice"}'

# 异步提交并等待执行完成
java -jar actiondock-cli.jar scripts execute-published <scriptId> \
  --input '{"name":"Bob"}' \
  --wait \
  --wait-timeout-seconds 60

# 从文件读取输入
java -jar actiondock-cli.jar scripts execute-published <scriptId> \
  --input-file input.json

# 从完整请求体文件读取
java -jar actiondock-cli.jar scripts execute-published <scriptId> \
  --file execute-request.json

# 指定返回视图
java -jar actiondock-cli.jar scripts execute-published <scriptId> \
  --response-view DEBUG

# Agent 安全流程：先校验，再预览，再执行
java -jar actiondock-cli.jar scripts execute-published <scriptId> \
  --input '{"name":"Alice"}' \
  --validate-only

java -jar actiondock-cli.jar scripts execute-published <scriptId> \
  --input '{"name":"Alice"}' \
  --dry-run
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--input` | `{}` | 内联执行入参 JSON |
| `--input-file` | - | 执行入参 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--file` | - | 完整请求体 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--mode` | `SYNC` | 提交模式：`SYNC` 或 `ASYNC` |
| `--response-view` | `RESULT` | 返回视图：`RESULT` 或 `DEBUG` |
| `--wait` | false | 提交后等待执行结束 |
| `--wait-timeout-seconds` | 30 | 等待超时时间（秒） |
| `--poll-interval-ms` | 1000 | 轮询间隔（毫秒） |
| `--dry-run` | false | 只输出最终 HTTP request preview，不执行脚本 |
| `--validate-only` | false | 只做本地参数和 JSON 校验，不创建 HTTP client |

### scripts fork

Fork 仓库脚本到一个新的可编辑脚本。

```bash
java -jar actiondock-cli.jar scripts fork <scriptId> --id hello-fork --name "Hello Fork"
java -jar actiondock-cli.jar scripts fork <scriptId> --id hello-fork --name "Hello Fork" --dry-run
```

### scripts development-status

查看开发脚本与来源仓库工具的同步状态。

```bash
java -jar actiondock-cli.jar scripts development-status <scriptId>
```

### scripts development-pull

从来源仓库拉取开发脚本更新。

```bash
java -jar actiondock-cli.jar scripts development-pull <scriptId>
java -jar actiondock-cli.jar scripts development-pull <scriptId> --force
java -jar actiondock-cli.jar scripts development-pull <scriptId> --force --dry-run
```

---

## executions 执行记录

### executions submit

提交一次脚本执行。执行的是当前脚本定义，不要求脚本已发布。

```bash
# 基本用法
java -jar actiondock-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Alice"}'

# 异步提交并等待
java -jar actiondock-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Bob"}' \
  --wait

# 自定义超时
java -jar actiondock-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Carol"}' \
  --wait \
  --wait-timeout-seconds 120

# Agent 安全流程：先校验，再预览，再提交
java -jar actiondock-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Alice"}' \
  --validate-only

java -jar actiondock-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Alice"}' \
  --dry-run
```

PowerShell 推荐把 JSON 作为 stdin 或文件传入，不把 JSON 作为命令行参数：

```powershell
@'
{
  "name": "Alice \"Ops\"",
  "team": "O'Brien"
}
'@ | java -jar actiondock-cli.jar `
  --script-id hello-groovy `
  --input-file - `
  --mode ASYNC `
  --response-view RESULT
```

```bash
# 完整请求体文件，适合复杂 JSON、CI/CD 和 Agent 调用
java -jar actiondock-cli.jar executions submit \
  --file execution-request.json
```

完整请求体 JSON 示例：

```json
{
  "scriptId": "hello-groovy",
  "input": {
    "name": "Alice"
  },
  "mode": "SYNC",
  "responseView": "RESULT"
}
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--script-id` | 必填，除非使用 `--file` | 要执行的脚本 ID |
| `--input` | `{}` | 内联执行入参 JSON；bash/zsh 简单对象可用，PowerShell 建议用文件或 stdin |
| `--input-file` | - | 执行入参 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--file` | - | 完整 `/api/executions` 请求体 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--mode` | `SYNC` | 提交模式：`SYNC` 或 `ASYNC` |
| `--response-view` | `RESULT` | 返回视图：`RESULT` 或 `DEBUG` |
| `--wait` | false | 提交后等待执行结束 |
| `--wait-timeout-seconds` | 30 | 等待超时时间（秒） |
| `--poll-interval-ms` | 1000 | 轮询间隔（毫秒） |
| `--dry-run` | false | 只输出最终 `/api/executions` request preview，不提交 |
| `--validate-only` | false | 只做本地参数和 JSON 校验，不创建 HTTP client |

### executions get

获取单次执行的详情。

```bash
java -jar actiondock-cli.jar executions get <executionId>
```

### executions list

列出执行记录。

```bash
# 列出全部
java -jar actiondock-cli.jar executions list

# 只看某个脚本的执行历史
java -jar actiondock-cli.jar executions list --script-id hello-groovy
```

### executions delete

删除单条执行记录。

```bash
java -jar actiondock-cli.jar executions delete <executionId>
java -jar actiondock-cli.jar executions delete <executionId> --dry-run
```

### executions clear

按脚本清空执行记录。服务端要求必须提供 `--script-id`。

```bash
java -jar actiondock-cli.jar executions clear --script-id hello-groovy
java -jar actiondock-cli.jar executions clear --script-id hello-groovy --dry-run
```

---

## schedules 定时任务

### schedules list

列出定时任务。

```bash
# 列出全部
java -jar actiondock-cli.jar schedules list

# 只列出某脚本下的定时任务
java -jar actiondock-cli.jar schedules list --script-id hello-groovy
```

### schedules get

获取单个定时任务详情。

```bash
java -jar actiondock-cli.jar schedules get <scheduleId>
```

### schedules create

创建定时任务。

```bash
# 从文件创建
java -jar actiondock-cli.jar schedules create --file schedule.json

# 从 stdin 读取
cat schedule.json | java -jar actiondock-cli.jar schedules create --file -

# 校验或预览
java -jar actiondock-cli.jar schedules create --file schedule.json --validate-only
java -jar actiondock-cli.jar schedules create --file schedule.json --dry-run
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
java -jar actiondock-cli.jar schedules update <scheduleId> --file schedule.json
java -jar actiondock-cli.jar schedules update <scheduleId> --file schedule.json --dry-run
```

### schedules enable

启用指定定时任务。

```bash
java -jar actiondock-cli.jar schedules enable <scheduleId>
java -jar actiondock-cli.jar schedules enable <scheduleId> --dry-run
```

### schedules disable

停用指定定时任务。

```bash
java -jar actiondock-cli.jar schedules disable <scheduleId>
java -jar actiondock-cli.jar schedules disable <scheduleId> --dry-run
```

### schedules delete

删除指定定时任务。

```bash
java -jar actiondock-cli.jar schedules delete <scheduleId>
java -jar actiondock-cli.jar schedules delete <scheduleId> --dry-run
```

---

## config-values 全局配置值

### config-values list

```bash
java -jar actiondock-cli.jar config-values list
```

### config-values get

```bash
java -jar actiondock-cli.jar config-values get openai.api_key
```

### config-values create

```bash
java -jar actiondock-cli.jar config-values create --file config-value.json
java -jar actiondock-cli.jar config-values create --file config-value.json --validate-only
java -jar actiondock-cli.jar config-values create --file config-value.json --dry-run
```

### config-values update

```bash
java -jar actiondock-cli.jar config-values update openai.api_key --file config-value.json
java -jar actiondock-cli.jar config-values update openai.api_key --file config-value.json --dry-run
```

### config-values delete

```bash
java -jar actiondock-cli.jar config-values delete openai.api_key
java -jar actiondock-cli.jar config-values delete openai.api_key --dry-run
```

### config-values copy-local-override / restore-repository-default

```bash
java -jar actiondock-cli.jar config-values copy-local-override managed.key
java -jar actiondock-cli.jar config-values restore-repository-default managed.key
```

配置值 JSON 示例：

```json
{
  "key": "openai.api_key",
  "value": "sk-...",
  "description": "OpenAI API Key"
}
```

---

## repositories 仓库和工具库

### repositories list/create/update/delete/sync

管理仓库定义。

```bash
java -jar actiondock-cli.jar repositories list
java -jar actiondock-cli.jar repositories create --file repository.json
java -jar actiondock-cli.jar repositories update repo-main --file repository.json
java -jar actiondock-cli.jar repositories delete repo-main
java -jar actiondock-cli.jar repositories sync repo-main

# Agent 安全流程
java -jar actiondock-cli.jar repositories create --file repository.json --validate-only
java -jar actiondock-cli.jar repositories create --file repository.json --dry-run
```

仓库定义 JSON 示例：

```json
{
  "id": "repo-main",
  "name": "Main",
  "type": "LOCAL_DIR",
  "url": "/tmp/actiondock-repo",
  "branch": "main",
  "enabled": true,
  "trustLevel": "TRUSTED",
  "usage": "DISTRIBUTION",
  "description": "Main repository"
}
```

### repositories tools list/get

查询仓库工具。

```bash
java -jar actiondock-cli.jar repositories tools list
java -jar actiondock-cli.jar repositories tools list --repository-id repo-main
java -jar actiondock-cli.jar repositories tools get repo-main hello-tool
```

### repositories tools install/update

安装或更新仓库工具。

```bash
java -jar actiondock-cli.jar repositories tools install repo-main hello-tool \
  --install-schedules \
  --install-plugin-dependencies

java -jar actiondock-cli.jar repositories tools install repo-main hello-tool \
  --install-schedules \
  --dry-run

java -jar actiondock-cli.jar repositories tools update repo-main hello-tool \
  --install-plugin-dependencies \
  --force-plugin-upgrade
```

### repositories tools develop/publish/uninstall

开发同步、发布本地脚本到仓库，以及卸载已安装工具。

```bash
java -jar actiondock-cli.jar repositories tools develop repo-main hello-tool --script-id hello-dev
java -jar actiondock-cli.jar repositories tools publish repo-main --file publish-tool.json
java -jar actiondock-cli.jar repositories tools uninstall hello-tool

java -jar actiondock-cli.jar repositories tools publish repo-main --file publish-tool.json --dry-run
```

发布仓库工具 JSON 示例：

```json
{
  "scriptId": "hello",
  "toolId": "hello",
  "displayName": "Hello",
  "version": "1.0.0",
  "owner": "team4u",
  "releaseNotes": "Initial release",
  "tags": ["demo"],
  "scheduleIds": [],
  "configItems": [],
  "force": false
}
```

### repositories plugins list/get/install/update/publish

管理仓库声明的插件。

```bash
java -jar actiondock-cli.jar repositories plugins list
java -jar actiondock-cli.jar repositories plugins list --repository-id repo-main
java -jar actiondock-cli.jar repositories plugins get repo-main demo-plugin
java -jar actiondock-cli.jar repositories plugins install repo-main demo-plugin
java -jar actiondock-cli.jar repositories plugins update repo-main demo-plugin --force
java -jar actiondock-cli.jar repositories plugins publish repo-main --file publish-plugin.json

java -jar actiondock-cli.jar repositories plugins install repo-main demo-plugin --dry-run
java -jar actiondock-cli.jar repositories plugins publish repo-main --file publish-plugin.json --dry-run
```

发布仓库插件 JSON 示例：

```json
{
  "pluginId": "demo-plugin",
  "displayName": "Demo Plugin",
  "version": "1.0.0",
  "owner": "team4u",
  "description": "Demo",
  "releaseNotes": "Initial release",
  "tags": ["demo"],
  "riskLevel": "LOW",
  "artifact": {
    "uri": "local://plugins/demo.jar",
    "sha256": "...",
    "fileName": "demo.jar"
  }
}
```

---

## plugins 插件管理

### plugins references / download

```bash
java -jar actiondock-cli.jar plugins references
java -jar actiondock-cli.jar plugins download <pluginId> --output demo-plugin.jar
java -jar actiondock-cli.jar plugins download <pluginId> --output demo-plugin.jar --dry-run
```

### plugins list

列出已安装插件。

```bash
java -jar actiondock-cli.jar plugins list
```

### plugins get

获取单个插件详情。

```bash
java -jar actiondock-cli.jar plugins get <pluginId>
```

### plugins install

上传并安装插件 JAR 包。

```bash
java -jar actiondock-cli.jar plugins install --jar plugin.jar
java -jar actiondock-cli.jar plugins install --jar plugin.jar --dry-run
java -jar actiondock-cli.jar plugins install --jar plugin.jar --validate-only
```

`plugins install --dry-run` 会输出 multipart request preview，只包含 `fieldName`、`fileName` 和 `size`，不会输出 JAR 内容。

### plugins upgrade

使用新的插件 JAR 升级指定插件。

```bash
java -jar actiondock-cli.jar plugins upgrade <pluginId> --jar new-plugin.jar
java -jar actiondock-cli.jar plugins upgrade <pluginId> --jar new-plugin.jar --dry-run
```

### plugins start

启动指定插件。

```bash
java -jar actiondock-cli.jar plugins start <pluginId>
java -jar actiondock-cli.jar plugins start <pluginId> --dry-run
```

### plugins stop

停止指定插件。

```bash
java -jar actiondock-cli.jar plugins stop <pluginId>
java -jar actiondock-cli.jar plugins stop <pluginId> --dry-run
```

### plugins delete

删除指定插件。

```bash
java -jar actiondock-cli.jar plugins delete <pluginId>
java -jar actiondock-cli.jar plugins delete <pluginId> --force
java -jar actiondock-cli.jar plugins delete <pluginId> --dry-run
```

### plugins invoke

调用插件的某个 action。

```bash
# 基本调用
java -jar actiondock-cli.jar plugins invoke <pluginId> <action>

# 带参数调用
java -jar actiondock-cli.jar plugins invoke <pluginId> <action> \
  --args '{"key":"value"}'

# 带脚本输入上下文
java -jar actiondock-cli.jar plugins invoke <pluginId> <action> \
  --args '{"key":"value"}' \
  --script-input '{"scriptInputKey":"scriptInputValue"}'

# 返回调试信息
java -jar actiondock-cli.jar plugins invoke <pluginId> <action> \
  --response-view DEBUG

# Agent 安全流程
java -jar actiondock-cli.jar plugins invoke <pluginId> <action> \
  --args '{"key":"value"}' \
  --validate-only

java -jar actiondock-cli.jar plugins invoke <pluginId> <action> \
  --args '{"key":"value"}' \
  --dry-run
```

PowerShell 推荐把多个 JSON 分别写入临时文件，或使用完整请求体文件：

```powershell
$argsJson = @'
{
  "topic": "ops \"night\""
}
'@

$scriptInputJson = @'
{
  "locale": "zh-CN"
}
'@

$argsPath = Join-Path $env:TEMP ("actiondock-args-{0}.json" -f [guid]::NewGuid())
$scriptInputPath = Join-Path $env:TEMP ("actiondock-script-input-{0}.json" -f [guid]::NewGuid())

[System.IO.File]::WriteAllText($argsPath, $argsJson, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($scriptInputPath, $scriptInputJson, [System.Text.UTF8Encoding]::new($false))

try {
  java -jar actiondock-cli.jar plugins invoke <pluginId> <action> `
    --args-file $argsPath `
    --script-input-file $scriptInputPath `
    --response-view RESULT
} finally {
  Remove-Item $argsPath -ErrorAction SilentlyContinue
  Remove-Item $scriptInputPath -ErrorAction SilentlyContinue
}
```

```bash
# 完整请求体文件
java -jar actiondock-cli.jar plugins invoke <pluginId> <action> \
  --file plugin-invoke-request.json
```

完整插件调用请求体 JSON 示例：

```json
{
  "args": {
    "topic": "ops"
  },
  "scriptInput": {
    "locale": "zh-CN"
  },
  "responseView": "RESULT"
}
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--args` | `{}` | 内联 action 参数 JSON；bash/zsh 简单对象可用，PowerShell 建议用文件 |
| `--args-file` | - | action 参数 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--script-input` | `{}` | 内联脚本输入上下文 JSON；bash/zsh 简单对象可用，PowerShell 建议用文件 |
| `--script-input-file` | - | 脚本输入上下文 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--file` | - | 完整插件调用请求体 JSON 文件路径，传 `-` 表示从 stdin 读取 |
| `--response-view` | `RESULT` | 返回视图：`RESULT` 或 `DEBUG` |
| `--dry-run` | false | 只输出最终插件调用 request preview，不调用插件 |
| `--validate-only` | false | 只做本地参数和 JSON 校验，不创建 HTTP client |

### plugins config get

获取插件配置。

```bash
java -jar actiondock-cli.jar plugins config get <pluginId>
```

### plugins config set

更新插件配置。

```bash
# 从文件设置
java -jar actiondock-cli.jar plugins config set <pluginId> --file config.json

# 从 stdin 读取
cat config.json | java -jar actiondock-cli.jar plugins config set <pluginId> --file -

# 校验或预览
java -jar actiondock-cli.jar plugins config set <pluginId> --file config.json --validate-only
java -jar actiondock-cli.jar plugins config set <pluginId> --file config.json --dry-run
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

## access-tokens 访问令牌

```bash
java -jar actiondock-cli.jar access-tokens list
java -jar actiondock-cli.jar access-tokens create --name "CI token"
java -jar actiondock-cli.jar access-tokens rename <tokenId> --name "Bot token"
java -jar actiondock-cli.jar access-tokens enable <tokenId>
java -jar actiondock-cli.jar access-tokens disable <tokenId>
java -jar actiondock-cli.jar access-tokens delete <tokenId>
```

---

## presets 执行参数预设

```bash
java -jar actiondock-cli.jar presets list <scriptId>
java -jar actiondock-cli.jar presets create <scriptId> --file preset.json
java -jar actiondock-cli.jar presets update <scriptId> <presetId> --file preset.json
java -jar actiondock-cli.jar presets delete <scriptId> <presetId>
```

---

## ai AI 工作台和运行

```bash
java -jar actiondock-cli.jar ai models list
java -jar actiondock-cli.jar ai models test <modelId> --file chat-request.json
java -jar actiondock-cli.jar ai agents run --file run-request.json
java -jar actiondock-cli.jar ai runs submit --file run-request.json --wait
java -jar actiondock-cli.jar ai tools test <toolName> --file tool-input.json
java -jar actiondock-cli.jar ai workbench generate-script --file workbench.json
java -jar actiondock-cli.jar ai chat --file chat-request.json
java -jar actiondock-cli.jar ai structured --file structured-request.json
java -jar actiondock-cli.jar ai embed --file embed-request.json
```

---

## 示例

```bash
# 查看当前配置
java -jar actiondock-cli.jar config current

# 使用指定配置执行
java -jar actiondock-cli.jar \
  --base-url http://localhost:8080 \
  --token local-dev-key \
  scripts list

# 提交执行并等待结果
java -jar actiondock-cli.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Alice"}' \
  --wait
```
