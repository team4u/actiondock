# 项目知识库解析

当问题依赖某个业务项目自身的文档、数据库说明、流程说明或 runbook 时，先不要直接扫源码，先通过 ActionDock 解析项目知识入口。

## 目标

用最少的平台能力，稳定拿到：

1. 目标项目仓库的根目录
2. 项目知识入口文件位置
3. 知识入口文件的原始 Markdown 内容

## 标准命令

先列出项目仓库：

```bash
actiondock repository list --purpose project --json
```

再解析具体项目：

```bash
actiondock repository resolve --repository-id <repositoryId> --json
```

这个命令只做定位和读取，不会触发仓库同步。

如果需要手工同步仓库，也可以使用：

```bash
actiondock repository sync <repositoryId> --json
```

这个命令主要用于手工刷新仓库内容，不是读取项目知识入口的必经步骤。

## 返回结果理解

典型返回：

```json
{
  "repositoryId": "billing-service",
  "type": "LOCAL_DIR",
  "purpose": "PROJECT",
  "root": "/Users/code/projects/billing-service",
  "entryPath": "ACTIONDOCK.md",
  "enabled": true,
  "exists": true,
  "content": "# Billing Service\n\n## 优先阅读\n\n1. `overview.md`\n..."
}
```

重点字段：

- `root`: 项目根目录
- `entryPath`: 项目知识入口文件，相对项目根目录
- `content`: 入口文件原始内容

## 工作流

### 1. 先读入口文件正文

返回结果里的 `content` 就是 `ACTIONDOCK.md` 正文。先读这份正文，再继续后面的文件读取和检索。

### 2. 按正文继续读取

接下来按 `ACTIONDOCK.md` 正文里给出的文件路径、目录、任务说明和关键词继续读取。

### 3. 只在必要时读源码

源码只有在以下场景再看：

- Markdown 没覆盖该问题
- 需要确认真实实现细节
- 文档和实现疑似不一致

### 4. 避免低价值目录

如果 `ACTIONDOCK.md` 没给出更具体规则，默认不要优先搜索这些目录或忽略文件：

- `dist`
- `build`
- `node_modules`
- `.git`
- `.gitignore`
- `.ignore`
- `.dockerignore`
- `.npmignore`
- `.eslintignore`
- `.prettierignore`

可以把这类文件统一理解为各类 `*ignore` 文件，通常不提供业务知识。

## 浏览项目知识库

解析项目仓库拿到 `root` 后，如果需要深入浏览项目目录和文件内容，**必须通过 `actiondock-workspace` 系统插件**，不能使用本地文件读取命令。因为 ActionDock 可能运行在远端，项目文件不在本地，只有通过插件才能访问远端的仓库内容。

该插件提供以下核心动作：

| 动作 | 用途 |
|------|------|
| `listDirectory` | 列出目录下的文件和子目录 |
| `viewTextFile` | 读取文本文件内容（支持行范围） |
| `writeTextFile` | 创建或覆盖文本文件 |
| `executeShellCommand` | 在项目目录下执行 Shell 命令（默认 Bash，Windows 优先 Git Bash；可通过 `shellPath` 指定 Shell，`allowedCommands` 限制可执行命令，支持超时设置） |
| `getSystemInfo` | 探测系统信息：工作区路径、系统环境（OS、Java 版本）、PATH 环境变量、可用 Shell（bash/sh/PowerShell/cmd）、常用命令版本（bash、python、python3、node、npm、npx、git、java、mvn），支持 `additionalCommands` 补充探测更多命令 |

通过 CLI 调用：

```bash
# 浏览项目根目录结构
actiondock plugin invoke actiondock-workspace listDirectory --path <root> --json

# 读取项目中的某个文件
actiondock plugin invoke actiondock-workspace viewTextFile --path <root>/docs/architecture.md --json

# 读取文件指定行范围
actiondock plugin invoke actiondock-workspace viewTextFile \
  --args-json '{"path":"<root>/README.md","viewRange":"1,50"}' --json

# 在项目目录下执行 Shell 命令
actiondock plugin invoke actiondock-workspace executeShellCommand \
  --args-json '{"command":"find <root>/src -name *.java | head -20"}' --json

# 探测系统信息（工作区、Shell、常用命令版本等）
actiondock plugin invoke actiondock-workspace getSystemInfo --json

# 探测系统信息并补充检测其他命令
actiondock plugin invoke actiondock-workspace getSystemInfo \
  --args-json '{"additionalCommands":["go","gradle","docker"]}' --json
```

如果不确定插件有哪些动作或参数，先查看插件详情（返回每个动作的 `inputSchema` 和 `outputSchema`）：

```bash
actiondock plugin get actiondock-workspace --json
```

## 回答用户时要体现的依据

如果结论依赖项目知识库，回答里应明确指出依据来自：

- `ACTIONDOCK.md`
- 具体的 Markdown 文档
- 必要时补充源码文件

## 术语

- `ACTIONDOCK.md`: 项目知识入口文件
- `project repository`: 被注册为 `purpose=PROJECT` 的仓库
- `knowledge source`: CAPABILITY 仓库中的知识源指针，安装后自动注册为 PROJECT 仓库
- `actiondock-workspace`: 内置系统插件，提供目录浏览、文件读写和 Shell 命令执行能力，浏览知识库时需配合使用

## 通过知识源安装

如果项目知识来自团队共享的 CAPABILITY 仓库中的知识源：

```bash
# 发现可用知识源
actiondock repository:knowledge-list --repository-id team-cap-repo --json

# 安装（自动注册为 PROJECT 仓库）
actiondock repository:knowledge-install --repository-id team-cap-repo --knowledge-id product-api
```

安装后，知识源自动成为 PROJECT 仓库，可通过标准 `repository resolve` 消费。
