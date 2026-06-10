# 项目知识库解析

本文件是 Playbook 下游的项目知识检索协议。业务项目、流程、数据库、接口、日志、告警和排障类问题默认先走 `playbook.md`；只有 Playbook 引导进入项目知识，或用户明确要求解析仓库 / 读取 `ACTIONDOCK.md` / 安装知识源时，才直接使用本文件。

先遵守 `references/common.md`。通用插件调用规则见 `plugin-usage.md`。

## 目标与入口

用最少平台能力拿到目标项目的：

1. 仓库根目录 `root`
2. 知识入口文件 `entryPath`
3. 入口文件原始 Markdown `content`

```bash
actiondock repository list --purpose project --intent "<regex>" --json
actiondock repository resolve --repository-id <repositoryId> --json
```

`repository resolve` 只定位和读取入口，不触发同步。需要手工刷新时再用：

```bash
actiondock repository sync <repositoryId> --json
```

典型返回字段：

```json
{
  "repositoryId": "billing-service",
  "purpose": "PROJECT",
  "root": "/Users/code/projects/billing-service",
  "entryPath": "ACTIONDOCK.md",
  "exists": true,
  "content": "# Billing Service\n..."
}
```

## 工作流

1. 先读 `content`，它就是 `ACTIONDOCK.md` 正文。
2. 按正文给出的文件路径、目录、任务说明和关键词继续读取。
3. Markdown 没覆盖、需要确认实现或文档疑似不一致时再看源码。
4. 如果入口没给更具体规则，默认不要优先搜索 `dist`、`build`、`node_modules`、`.git`、各类 `*ignore` 文件。

## 浏览项目内容

解析仓库拿到 `root` 后，深入浏览目录和文件必须通过 `actiondock-workspace` 系统插件，不能使用本地文件命令。ActionDock 可能运行在远端，项目文件不一定在当前机器。

核心动作：

| 动作 | 用途 |
|------|------|
| `listDirectory` | 列目录 |
| `viewTextFile` | 读取文本文件，支持行范围 |
| `writeTextFile` | 创建或覆盖文本文件 |
| `findFiles` | 跨平台查找文件，支持 glob 和常见生成目录跳过 |
| `searchText` | 搜索 UTF-8 文本，默认正则 |
| `exec` | 执行 Shell 命令，`cwd` 显式传入时必须已存在 |
| `getSystemInfo` | 探测工作区、OS、PATH、Shell 和常用命令版本 |

常用命令：

```bash
actiondock plugin invoke actiondock-workspace listDirectory --path <root> --json

actiondock plugin invoke actiondock-workspace viewTextFile \
  --path <root>/docs/architecture.md \
  --json

actiondock plugin invoke actiondock-workspace viewTextFile \
  --path <root>/README.md \
  --viewRange 1,50 \
  --json

actiondock plugin invoke actiondock-workspace findFiles \
  --path <root> \
  --args-json '{"includeGlobs":["**/*.java"],"excludeGlobs":["**/*Test.java"]}' \
  --json

actiondock plugin invoke actiondock-workspace searchText \
  --path <root> \
  --query 'TODO|FIXME' \
  --contextLines 1 \
  --args-json '{"includeGlobs":["**/*.java"]}' \
  --json

actiondock plugin invoke actiondock-workspace searchText \
  --path <root> \
  --query actiondock \
  --regex false \
  --caseSensitive false \
  --json

actiondock plugin invoke actiondock-workspace exec \
  --command 'git status --short' \
  --cwd <existing-dir> \
  --check false \
  --json

actiondock plugin invoke actiondock-workspace getSystemInfo --json

actiondock plugin invoke actiondock-workspace getSystemInfo \
  --args-json '{"additionalCommands":["go","gradle","docker"]}' \
  --json
```

不确定动作或 schema 时：

```bash
actiondock plugin get actiondock-workspace --json
actiondock plugin action actiondock-workspace <action> --json
```

## 回答依据

结论依赖项目知识库时，回答里明确指出依据来自：

- `ACTIONDOCK.md`
- 具体 Markdown 文档
- 必要时补充源码文件

## 知识源安装

团队共享 CAPABILITY 仓库中的知识源可安装为 PROJECT 仓库：

```bash
actiondock repository:knowledge-list --repository-id team-cap-repo --intent "<regex>" --json
actiondock repository:knowledge-install --repository-id team-cap-repo --knowledge-id product-api --json
```

安装后按标准 `repository resolve` 消费。
