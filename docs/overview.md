# ActionDock 技术概览

ActionDock 是一个面向团队内部的自动化工具平台。它把散落在个人电脑、服务器和项目目录里的脚本，整理成可管理、可调用、可分发、可审计的团队能力。

一份脚本定义可以同时被 CLI、管理台、REST API、定时任务、Webhook 和 AI Agent 使用。团队不需要为每种入口维护一套参数说明，也不需要在多个 Skill、多个节点或多个项目里复制同一段实现。

它最有价值的地方不是“能跑脚本”，而是把脚本从个人习惯，变成团队可以复用、治理和持续演进的能力。


## 为什么需要它

团队里的自动化脚本通常会经历几个阶段：

1. 一开始只是某个人写在本机的脚本。
2. 后来被复制到服务器、CI、文档、AI Skill 或其他项目里。
3. 再后来参数变了、配置变了、依赖变了，不同副本开始不一致。
4. 出问题时，很难知道是谁在什么时候用什么参数执行过。

这类问题不是脚本语言的问题，而是缺少统一的运行约定：

- 脚本的身份是什么。
- 输入参数是什么，哪些字段必填，类型是什么。
- 输出结果是什么。
- 依赖哪些脚本、插件、配置值、AI 模型或外部服务。
- 哪个版本是稳定版本。
- 谁执行过，执行结果和日志在哪里。

ActionDock 的核心目标，就是把这些约定沉淀到平台里。


## 脚本资产化

在 ActionDock 中，脚本不是一段孤立源码，而是一个 `ScriptDefinition`。它包含脚本 ID、名称、类型、源码、输入输出 Schema、依赖声明和发布快照。

一个简化示例：

```java
ScriptDefinition script = new ScriptDefinition()
    .setId("hello-groovy")
    .setName("Hello Groovy")
    .setType(ScriptType.GROOVY)
    .setSource("""
        def name = input.name ?: "World"
        return [message: "Hello, " + name + "!", upperName: name.toUpperCase()]
        """)
    .setInputSchema(Map.of(
        "type", "object",
        "properties", Map.of(
            "name", Map.of("type", "string", "title", "Name")
        )
    ))
    .setOutputSchema(Map.of(
        "type", "object",
        "properties", Map.of(
            "message", Map.of("type", "string", "title", "Message"),
            "upperName", Map.of("type", "string", "title", "Upper Name")
        )
    ));
```

这里最重要的是 `inputSchema` 和 `outputSchema`。它们不是只给人看的文档，而是平台运行时会使用的结构化契约。

示例里没有展开依赖字段。实际脚本还可以声明脚本依赖、插件依赖和 Python requirements，这些信息会跟随发布快照和仓库分发一起流转。


## 一份 Schema，多种入口

脚本定义好以后，同一份 Schema 会被多个入口复用：

| 入口 | Schema 的作用 |
|------|---------------|
| CLI | 自动展开为 `--name alice` 这样的命令行参数 |
| 管理台 | 自动生成执行表单，支持表单模式和 JSON 模式 |
| REST API | 作为统一的输入输出约定 |
| 定时任务 | 保存固定输入并按 Cron 执行 |
| Webhook | 把外部事件映射成脚本输入 |
| AI Agent | 生成工具描述，降低模型传错参数的概率 |
| 执行引擎 | 执行前校验输入类型和必填字段 |

这样做的直接收益是：参数约定只有一份。脚本、CLI、管理台、AI 工具描述不需要分别维护，减少了“文档说一套、实际运行另一套”的问题。


## 草稿和发布

脚本生命周期分为草稿和发布两个状态：

```text
DRAFT -> PUBLISHED
  ^          |
  |          |
  +-- discard draft
```

- 草稿用于编辑和调试，可以通过 `--draft` 执行。
- 发布会生成稳定快照。
- 丢弃草稿可以回到上一次发布状态。

定时任务、脚本互调和 AI 工具调用应优先使用发布版本。这样团队可以放心修改草稿，不会影响线上自动化流程。


## 一个脚本，多种调用方式

### CLI

```bash
actiondock script run hello-groovy --name alice --json
```

CLI 会根据 `inputSchema` 解析动态参数。复杂输入可以使用 JSON：

```bash
actiondock script run report-daily \
  --input-json '{"date":"2026-05-09","sendEmail":true}' \
  --response-view debug
```

常见脚本生命周期也可以在终端完成：

```bash
actiondock script create \
  --script-id cleanup-temp-files \
  --name "Cleanup Temp Files" \
  --type groovy \
  --source-file ./cleanup.groovy

actiondock script validate cleanup-temp-files
actiondock script run cleanup-temp-files --draft --input-json '{"dryRun":true}'
actiondock script publish cleanup-temp-files
```

### REST API

```bash
curl -X POST http://localhost:5177/api/scripts/hello-groovy/execute \
  -H 'Content-Type: application/json' \
  -d '{"input":{"name":"alice"},"mode":"SYNC"}'
```

### 管理台

管理台适合日常查看、编辑、发布和手动执行。脚本输入会根据 Schema 生成表单，也可以切换到 JSON 模式处理复杂参数。

### 定时任务

定时任务保存脚本 ID、Cron 表达式和固定输入。每次触发都会生成执行记录，方便排查历史结果。

### Webhook

外部系统可以通过事件源触发脚本。事件进入后会经过标准化、过滤、幂等和输入映射，再提交给目标脚本执行。

```text
外部系统
  -> 事件源鉴权
  -> 标准化处理
  -> 触发器过滤
  -> 幂等检查
  -> 输入映射
  -> 执行脚本
  -> 记录事件和派发结果
```

### AI Agent

ActionDock 里的 Agent Profile 不是单纯的一段 Prompt，而是由模型、工具和 Skill 共同组成：

- Model Profile：决定用哪个模型、供应商和 API Key。
- Toolset / Direct Tools：决定 Agent 能实际调用哪些工具。
- Skills：决定 Agent 具备哪些任务知识、流程约束和使用说明。

已发布的 `TOOL` 类型脚本会暴露为 ActionDock AI 工具，工具名形如 `script.<scriptId>`，并可以通过 Toolset 或 Direct Tools 授权给 Agent 使用。脚本的 `inputSchema` 会变成工具输入结构，Agent 不需要靠 Prompt 猜参数；Toolset 的权限级别也能限制 Agent 能调用哪些类型的工具。

Skill 是另一层。平台里的 Skill 管理模块负责安装和维护 Skill，Agent Profile 可以选择已经安装且启用的 Skill 作为自己的技能。Skill 本身不是执行入口，它更像 Agent 的知识包：告诉 Agent 某类任务的背景、流程、边界、示例和工具使用方式。

例如团队要做一个告警分诊 Agent：

- `send-message`、`query-oncall`、`create-ticket` 这类脚本发布后，作为工具加入 `incident-tools` Toolset。
- 团队再维护一个 `incident-triage` Skill，描述告警等级判断、升级规则、信息整理口径和处理边界。
- Agent Profile 同时绑定这个 Toolset 和 Skill。

这样 Agent 在处理告警任务时，Skill 负责判断和流程上下文，工具脚本负责实际动作。两者分工不同，但执行过程仍然进入 ActionDock 的记录和审计体系。

平台也可以基于脚本生成 Skill 示例，包含 `scriptId`、输入输出 Schema、CLI 调用命令和 HTTP 回退命令。这个生成结果的价值不是把脚本注册成工具，而是快速生成一份可复用的技能说明；团队可以把它纳入 Skill 管理，再按需绑定到 Agent 或同步给外部 AI 编码助手。


## CLI 可以控制多个节点

ActionDock CLI 不只是本机脚本运行入口。它可以通过 profile、`--server`、`--token` 和环境变量连接不同的 ActionDock 服务端。

```bash
# 为不同 ActionDock 服务端保存连接配置
actiondock config add local --server http://127.0.0.1:5177
actiondock config add dev --server http://dev-actiondock:5177 --token dev-token
actiondock config add prod --server https://actiondock.example.com --token prod-token

# 切换默认连接到 dev 节点
actiondock config use dev
actiondock script list

# 临时指定 prod 节点执行脚本，不影响当前默认 profile
actiondock script run cleanup-temp-files --profile prod --dryRun true --json
```

这个能力适合团队内部多节点场景：

- 本地节点用于开发和调试。
- 测试节点用于验证脚本和事件触发。
- 生产节点用于执行稳定版本。
- 内网机器或专用服务器可以作为自动化执行节点。

同一个 CLI 可以管理不同机器上的脚本、配置值、共享状态、定时任务、事件源、插件、仓库和执行记录。


## 跨语言调用

不同人使用的脚本语言可能不同，有 Groovy 也有 Python，每个语言的生态优势不一样。没有统一运行时的时候，不同语言之间的调用非常困难。

ActionDock 打通了跨语言调用，两种语言可以双向调用。Groovy 可以直接调 Python，Python 也可以继续调平台里的脚本、插件和配置。

脚本执行时，ActionDock 会注入一组运行时对象。Groovy 和 Python 都可以使用这些能力：

| 对象 | 作用 |
|------|------|
| `scripts` | 调用其他已发布脚本 |
| `plugins` | 调用 Java 插件动作 |
| `state` | 读写共享状态 |
| `config` | 读取全局配置值 |
| `log` | 写入执行日志 |

例如在 Groovy 中调用另一个脚本：

```groovy
def result = scripts.invoke("python-data-processor", [input: rawData])
```

在 Python 中也可以继续调用平台内能力：

```python
report = scripts.invoke("groovy-report-generator", {"data": processed})
message = plugins.invoke("notification-plugin", "send", {"channel": "email"})
```

这样写的直接收益很实际：我们可以选择合适的语言，做合适的事情，不可以考虑脚本语言的选择。

Groovy 脚本在 JVM 内执行，并缓存编译结果。Python 脚本通过子进程执行，使用 JSON 作为输入输出格式；日志、脚本互调、插件调用和状态操作通过运行时桥接完成。

Python 桥接的实现也保持简单：stdin 传入脚本输入，stdout 返回脚本结果，stderr 承载带前缀的控制消息，例如日志、`scripts.invoke()`、`plugins.invoke()` 和 `state` 操作。这样 Python 可以使用自己的生态库，同时仍然接入 ActionDock 的执行记录、配置、状态和插件体系。


## 插件扩展：脚本侧一行调用内部 Java 能力

脚本适合做编排，但团队里总会有一些能力不适合长期写在脚本里，比如内部 SDK、专有系统接入、统一鉴权、复杂协议适配。这类能力可以沉淀成插件，然后继续被脚本用同一种方式调用。

插件基于 PF4J，打包成 JAR 后安装到 ActionDock。脚本侧通过 `plugins.invoke()` 调用：

```groovy
def result = plugins.invoke("my-plugin", "hello", [name: "world"])
```

```python
result = plugins.invoke("my-plugin", "hello", {"name": "world"})
```

插件通过清单文件声明自己的动作、配置 Schema、输入 Schema 和输出 Schema。平台支持安装、启动、停止、升级和卸载插件。升级失败时会回滚到旧版本，避免一次插件升级影响已有流程。

对使用方来说，平台里沉淀下来的能力都能按同一种方式调用。


## 配置和环境隔离

团队把脚本放到共享平台以后，真正容易失控的通常不是脚本代码本身，而是环境差异：谁在用哪套密钥、哪个节点连哪个地址、仓库更新后本地覆盖还能不能保住。

ActionDock 把这些环境信息集中到配置层里。脚本和插件可以通过 `config.get()` 或 `${config.some-key}` 引用配置，敏感值可以标记为 Secret，在管理台和接口中脱敏展示。

仓库分发的工具也可以携带配置模板。安装后，模板会同步成受管配置值；本地环境可以复制为本地覆盖值，后续仓库更新时仍保留本地差异。这对 dev、test、prod 使用不同密钥和地址的场景很关键。


## AI 能力：不是外挂，而是平台原生能力

ActionDock 的 AI 能力不是单独挂在外面的旁路系统，而是接进了同一套脚本、插件、配置和审计体系。脚本注册成工具只是入口，后面还有模型配置、结构化输出、向量化、Agent Run 和执行记录。

主要概念：

- Model Profile：模型供应商、模型名称和 API Key 配置。
- Toolset：Agent 可用工具集合，并带有权限级别。
- Agent Profile：模型、System Prompt、Toolset、Skill 和运行选项。
- Agent Run：一次 Agent 执行记录，包含步骤、工具调用和状态。

内置 `actiondock-ai` 插件覆盖四类常用能力：`chat` 用于普通对话，`structured` 用于按 Schema 返回结构化结果，`embed` 用于向量化文本，`agentRun` 用于从脚本中发起一次 Agent 执行。

脚本可以调用内置 `actiondock-ai` 插件：

```groovy
def result = plugins.invoke("actiondock-ai", "structured", [
    modelProfile: "default-chat",
    messages: [[role: "user", content: "从这封邮件里提取日期和金额"]],
    outputSchema: [
        type: "object",
        properties: [
            date: [type: "string"],
            amount: [type: "number"]
        ]
    ]
])
```

Agent 也可以把已发布的 `TOOL` 类型脚本当成工具调用。这样团队可以先把稳定的内部能力沉淀到 ActionDock，再让 AI 在受控的 Toolset 范围内使用这些能力。

这里的重点不是“让 AI 什么都能做”，而是把 AI 能做的事收敛到平台已经定义好的工具、权限和审计里。脚本工具的 Schema 限定输入，Toolset 限定可用范围，Agent Run 留下执行过程。


## 仓库分发：像内部软件源一样管理工具

团队内部工具一旦变多，真正麻烦的不是“有没有脚本”，而是“别人怎么发现、怎么安装、怎么更新、怎么知道自己装的是不是同一版”。ActionDock 的 Repository 机制就是为这个问题准备的：

- 脚本工具。
- 插件。
- 事件源资产。
- AI 能力包。
- Skills。

仓库可以是 Git、HTTP 或本地目录。同步仓库后，团队成员可以从管理台或 CLI 发现、安装和更新工具。

这让团队可以把常用能力沉淀成内部工具库，而不是靠复制脚本、发压缩包或在聊天里贴命令。对使用方来说，更接近“发现一个工具，然后安装它”，而不是“拿到一段脚本，再自己补齐环境”。

仓库资产不只包含源码本身，还可以带上脚本依赖、插件依赖、调度模板和配置模板。安装时可以选择是否连同依赖一起安装，减少“脚本装好了，但环境还缺一堆东西”的落地成本。

仓库还支持开发同步场景。开发仓库里的工具可以拉取成本地开发脚本，平台会记录来源仓库、工具 ID、版本、提交和摘要，并判断本地改动、远端改动或两边同时改动。这样团队可以在平台里调试脚本，同时保留从内部仓库更新的通道。


## Skill 管理：平台内给 Agent，用平台外给 IDE

Skill 管理模块负责把 Skill 作为平台资产统一维护。Skill 可以从仓库、GitHub 集合、本地目录或 ZIP 安装，也可以同步到不同目标目录。这样团队里的知识、流程和工具说明不必散落在聊天记录、Prompt 模板和个人目录里。

支持的目标包括 Claude、Codex、Gemini、CodeBuddy 和自定义目录。

在 ActionDock 内部，已安装且启用的 Skill 可以被 Agent Profile 选择，作为 Agent 运行时加载的技能上下文。它适合沉淀团队流程、工具使用规范、业务边界和示例。

对外部 AI 编码助手，Skill 也可以同步到对应目标目录，让团队成员在 IDE 或 AI 客户端里复用同一套工具说明。

因此 Skill 管理连接了两类场景：

- 平台内：Agent 绑定 Skill，把团队知识加载到 Agent 上下文。
- 平台外：把同一份 Skill 同步给外部 AI 编码助手使用。


## 执行审计和治理

团队使用自动化工具时，治理能力很重要。ActionDock 提供了一组基础能力：

- 执行记录：保存输入、输出、状态、日志和错误详情。
- 事件记录：保存外部事件、标准化结果和触发器派发结果。
- 访问令牌：为 CLI、CI 或外部系统创建 Bearer Token，可启用、禁用和吊销。
- 配置值：集中管理普通配置和 Secret。
- 共享状态：集中保存跨脚本共享数据，支持过期时间和敏感值标记。
- 数据备份：管理台支持导出和恢复系统数据包，可用于升级前备份、环境迁移和故障恢复；导出时也可以按需要处理 Skill、Secret 等内容。

这些能力不会让脚本本身更复杂，但能让团队更放心地把脚本放到共享环境里运行。


## 快速开始

安装并启动：

```bash
npm install -g actiondock
actiondock server
```

启动后访问：

```text
http://localhost:5177/admin/app/scripts
```

执行内置示例：

```bash
actiondock script run hello-groovy --name alice --json
```

成功时会看到类似结果：

```json
{
  "status": "SUCCESS",
  "output": {
    "message": "Hello, alice!",
    "upperName": "ALICE"
  }
}
```

接下来可以尝试：

- 创建一个团队常用脚本，并补充输入输出 Schema。
- 用 CLI 和管理台分别执行它。
- 发布后添加一个定时任务。
- 为不同环境配置 CLI profile。
- 把脚本发布到内部仓库，供团队共享。

## 总结

ActionDock 解决的不是“怎么写脚本”，而是“团队怎么长期使用脚本”。

它把脚本变成有 Schema、有版本、有入口、有权限、有审计、有分发渠道的工具资产。对团队内部来说，这比单纯维护一堆脚本文件更可控，也更容易和 CLI、自动化事件、AI Agent 以及日常运维流程结合。
