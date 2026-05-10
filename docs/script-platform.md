# ActionDock：让脚本真正可复用

ActionDock 是一个自动化工具平台。它做的事很直接：把散落在个人电脑、服务器和项目目录里的脚本，整理成可以被稳定调用、复用和分发的工具资产。

你可以先把它当成自己的脚本管理和自动化入口；如果想分享给别人，也可以很方便地往共享、分发和治理延伸。

脚本本身并不稀缺。真正麻烦的是后面的事：别人怎么调用，参数怎么传，版本怎么固定，执行记录怎么追踪，已有能力怎么复用，AI Agent 又怎么安全地使用这些内部工具。

ActionDock 解决的是这些后续问题。


## 为什么需要它

很多自动化一开始都很轻：一个脚本、一个命令、一个临时任务。只要能跑通，当时就够了。

问题通常出现在它开始有用之后。脚本被复制到服务器、CI、文档、AI Skill 或其他项目里；参数改过几次，调用方却没同步；依赖换了版本，某些副本还停在旧逻辑；出问题时，也很难知道是谁在什么时候用什么输入执行过。

这类问题不是某种脚本语言的问题，而是脚本缺少一套可以长期运行的约定：

- 它的身份是什么。
- 输入参数是什么，哪些字段必填，类型是什么。
- 输出结果是什么。
- 依赖哪些脚本、插件、配置值、AI 模型或外部服务。
- 哪个版本是稳定版本。
- 谁执行过，执行结果和日志在哪里。

ActionDock 想做的事，就是把这些约定落到平台里。脚本仍然是脚本，但它不再只是一段散落的源码。


## 脚本资产化

脚本一旦要被复用，只有源码是不够的。源码能说明“它做了什么”，但很难完整说明“它是谁、怎么调用、依赖什么、哪个版本可以放心用”。

在 ActionDock 中，脚本会被整理成一个 `ScriptDefinition`。它包含脚本 ID、名称、类型、源码、输入输出 Schema、依赖声明和发布快照。也就是说，脚本从一段代码变成了一个有身份、有契约、有版本边界的资产。

一个简化示例：

```json
{
  "id": "hello-groovy",
  "name": "Hello Groovy",
  "type": "GROOVY",
  "source": "def name = input.name ?: \"World\"\\nreturn [message: \"Hello, \" + name + \"!\", upperName: name.toUpperCase()]",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "title": "Name"
      }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "title": "Message"
      },
      "upperName": {
        "type": "string",
        "title": "Upper Name"
      }
    }
  }
}
```

这里最重要的是 `inputSchema` 和 `outputSchema`。它们不是只给人看的文档，而是平台运行时会使用的结构化契约。

实际脚本还可以声明脚本依赖、插件依赖和 Python requirements。这些信息会跟随发布快照和仓库分发一起流转，别人安装或调用时，不需要再从零猜环境。


## 一份 Schema，多种入口

脚本被更多入口调用时，最容易乱的是参数。CLI 写一套说明，管理台写一套表单，REST API 写一套文档，AI Agent 的 Prompt 里再补一套工具描述，时间一长就会不一致。

ActionDock 把参数约定收进 Schema。脚本只维护一份输入输出契约，多个入口都基于这份 Schema 工作：

| 入口 | Schema 的作用 |
|------|---------------|
| CLI | 自动展开为 `--name alice` 这样的命令行参数 |
| 管理台 | 自动生成执行表单，也支持切到 JSON 模式 |
| REST API | 统一的输入输出约定 |
| 定时任务 | 保存固定输入，按 Cron 触发 |
| Webhook | 把外部事件映射成脚本输入 |
| AI Agent | 生成工具描述，减少模型瞎猜参数的情况 |
| 执行引擎 | 执行前校验输入类型和必填字段 |

这样带来的价值很直接：入口可以变多，但参数规则不用复制多份。定义一次，到处复用。

这份 Schema 会直接落到不同入口上。

### CLI

```bash
actiondock script run hello-groovy --name alice --json
```

CLI 会根据 `inputSchema` 解析动态参数。复杂输入可以直接传 JSON：

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

管理台用来查看、编辑、发布和手动跑脚本。表单会根据 Schema 自动生成，复杂参数也可以切到 JSON 模式。

### 定时任务

定时任务保存脚本 ID、Cron 表达式和固定输入，每次触发都有记录可查。

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


## 草稿和发布

脚本被定时任务、Webhook、AI Agent 或其他脚本调用以后，随手改源码就变成了风险。你可能只是想调试一个字段，但线上流程已经开始跑这份改动。

ActionDock 把脚本分成草稿和发布两个状态。草稿用来调试，发布后生成稳定快照。要放弃当前改动，丢弃草稿就回到上一个发布状态。

这让脚本可以像一个小型工具一样演进：开发时有试错空间，真正被定时任务、脚本互调和 AI 工具调用时，则尽量使用发布版本，避免草稿改动意外影响稳定流程。


## 跨语言调用

真实的自动化流程很少只适合一种语言。流程编排、系统操作可能更适合 Groovy；数据处理、爬取、文本处理又更想直接用 Python 生态。没有统一运行时的时候，跨语言协作往往要拆成服务、HTTP 接口或一堆临时命令。

ActionDock 打通了这件事。Groovy 能调 Python，Python 也能反向调 Groovy 脚本。

脚本执行时，平台会注入一组运行时对象，两种语言都能用：

| 对象 | 作用 |
|------|------|
| `scripts` | 调用其他已发布脚本 |
| `state` | 读写共享状态 |
| `config` | 读取全局配置值 |
| `log` | 写入执行日志 |

例如在 Groovy 中调用另一个脚本：

```groovy
def result = scripts.invoke("python-data-processor", [input: rawData])
```

在 Python 中也可以反向调用 Groovy 脚本：

```python
report = scripts.invoke("groovy-report-generator", {"data": processed})
```

这样就能选合适的语言做合适的事，不需要为了跨语言调用再单独维护一层微服务。

Groovy 在 JVM 里跑，会缓存编译结果。Python 通过子进程执行，用 JSON 做输入输出，平台通过 stdin/stdout/stderr 做桥接。


## 插件扩展

脚本适合表达流程，但不是所有能力都适合长期写在脚本里。内部 SDK、专有系统接入、统一鉴权、复杂客户端封装这类能力，如果每个脚本都写一遍，很快会变成另一种复制。

ActionDock 用插件来沉淀这类稳定能力。插件基于 PF4J，打成 JAR 安装到平台里，通过 `plugins.invoke()` 调用。

不管脚本是 Groovy 还是 Python，都可以用同样的方式调用插件：

```groovy
def result = plugins.invoke("my-plugin", "hello", [name: "world"])
```

```python
result = plugins.invoke("my-plugin", "hello", {"name": "world"})
```

插件清单声明动作、配置 Schema、输入输出 Schema。平台支持安装、启动、停止、升级和卸载，升级失败会回滚。

这样脚本可以专注编排，插件负责沉淀底层能力。对脚本作者来说，底层到底是 Groovy、Python 还是 Java 插件并不重要。重要的是，平台里沉淀下来的能力都能按同一种方式调用。


## CLI 可以控制多个节点

脚本平台通常不会只有一个环境。本地要开发调试，测试环境要验证，生产环境要跑稳定版本，有些内网机器或专用服务器还可能承担执行节点。如果每次都手动换地址、换 Token、换命令，很容易出错。

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

一个 CLI 可以管理不同机器上的脚本、配置、状态、定时任务、事件源、插件、仓库和执行记录。对经常在本地、测试、生产之间切换的人来说，这个能力会明显减少上下文切换。


## AI 接入

AI Agent 调内部工具时，最怕两件事：一是工具参数只写在 Prompt 里，模型只能猜；二是 Skill、工具、执行权限混在一起，后面很难治理。

ActionDock 的 AI 能力接进了同一套脚本、插件、配置和审计体系。对 AI 来说，脚本不是一段只能写在 Prompt 里的说明，而是可以直接暴露成工具。

先看 Agent 这一侧。ActionDock 里的 Agent Profile 不只是一段 Prompt，而是模型、工具和 Skill 的组合：

- Model Profile：选哪个模型、哪个供应商、填什么 API Key。
- Toolset / Direct Tools：Agent 能调用哪些工具。
- Skills：Agent 具备哪些任务知识、流程约束和使用说明。

已发布的 `TOOL` 类型脚本会暴露为 ActionDock AI 工具，工具名是 `script.<scriptId>`，通过 Toolset 或 Direct Tools 授权给 Agent。脚本的 `inputSchema` 会直接变成工具输入结构，Agent 不需要靠 Prompt 猜参数。

Skill 是另一层。它不是执行入口，更像是 Agent 的知识包：告诉它某类任务的背景、流程、边界和工具用法。

举个例子，要做告警分诊 Agent：

- `send-message`、`query-oncall`、`create-ticket` 这些脚本发布后，加到 `incident-tools` Toolset。
- 再维护一个 `incident-triage` Skill，说明告警怎么判断等级、什么时候升级、信息怎么整理。
- Agent Profile 绑定这个 Toolset 和 Skill。

处理告警时，Skill 管判断和流程，工具脚本管实际操作。两者各司其职，执行过程都会进 ActionDock 的记录。

平台也支持基于脚本生成 Skill 示例，包含 `scriptId`、Schema、CLI 和 HTTP 调用方式。生成的不是工具注册文件，而是可复用的技能说明，可以进一步加工，再绑定给 Agent 或同步给外部 AI 编码助手。

再看模型调用这一侧。内置 `actiondock-ai` 插件覆盖四类能力：`chat` 对话，`structured` 按 Schema 返回结构化结果，`embed` 向量化文本，`agentRun` 从脚本里发起一次 Agent 执行。

脚本调用方式：

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

重点不是“让 AI 什么都能做”，而是把 AI 能做的事收敛到平台已经定义好的工具、权限和审计里。

Skill 管理模块也围绕这件事展开。它可以从仓库、GitHub 集合、本地目录或 ZIP 安装 Skill，也可以同步到不同目标目录。平台内，Agent Profile 可以直接绑定已安装 Skill；平台外，也可以同步到 Claude、Codex、Gemini、CodeBuddy 或自定义目录，让 IDE 和 AI 客户端共用同一套工具说明。


## 仓库分发

工具变多后，真正麻烦的不是“有没有”，而是“别人怎么发现、怎么安装、怎么更新、怎么知道自己装的是不是同一版”。

ActionDock 的 Repository 机制解决这个问题。仓库里可以放：

- 脚本工具
- 插件
- 事件源资产
- AI 能力包
- Skills

仓库可以是 Git、HTTP 或本地目录。同步后，从管理台或 CLI 发现、安装和更新。

这样就可以把常用能力沉淀成工具库，不用靠复制脚本、发压缩包或在聊天里贴命令。

仓库资产不只包含源码，还可以带上依赖、调度模板和配置模板。安装时可以选择是否连同依赖一起装，省得“脚本装好了，环境还缺一堆东西”。

仓库也支持开发同步。开发仓库里的工具可以拉取成本地脚本，平台会记录来源、版本、提交和摘要，并判断本地改动、远端改动或两边同时改动。这样可以在平台里调试脚本，同时保留从仓库更新的通道。


## 配置和环境隔离

脚本放到长期运行的环境后，真正容易失控的往往不是代码，而是环境。谁在用哪套密钥，哪个节点连哪个地址，仓库更新后本地覆盖还能不能保住，这些都不适合散落在脚本里。

ActionDock 把这些环境信息集中到配置层。脚本和插件通过 `config.get()` 或 `${config.key}` 引用配置，敏感值标记为 Secret 后会在管理台和接口中脱敏。

仓库分发的工具也可以带配置模板。安装后，模板同步成受管配置；本地环境可以复制为本地覆盖值，仓库更新时保留本地差异。这对 dev、test、prod 用不同密钥和地址的场景很实用。


## 执行审计和治理

自动化越有用，越需要知道它到底做过什么。脚本被人手动执行、被定时任务触发、被 Webhook 调用、被 AI Agent 使用以后，如果没有统一记录，排查问题只能靠猜。

ActionDock 提供这些治理能力：

- 执行记录：保存输入、输出、状态、日志和错误详情。
- 事件记录：保存外部事件、标准化结果和触发器派发结果。
- 访问令牌：为 CLI、CI 或外部系统创建 Bearer Token，可启用、禁用和吊销。
- 配置值：集中管理普通配置和 Secret。
- 共享状态：集中保存跨脚本共享数据，支持过期时间和敏感值标记。
- 数据备份：管理台支持导出和恢复系统数据包，用于升级前备份、环境迁移和故障恢复；导出时可以按需要处理 Skill、Secret 等内容。

这些能力不会让脚本本身更复杂，但会让脚本放到长期运行的环境里更稳。


## 典型场景

ActionDock 适合那些一开始只是脚本，后来需要反复执行、多人复用或接入其他系统的自动化场景：

- 运维巡检：定时检查服务状态、磁盘、日志、证书，把结果写入执行记录。
- 数据同步：从一个系统拉数据，处理后写入另一个系统，配置和游标交给平台管理。
- 报表生成：用 Python 处理数据，用 Groovy 编排流程，再通过插件或脚本发送结果。
- 告警处理：Webhook 接收事件，脚本过滤、补充上下文，再创建工单或发通知。
- AI Agent 调内部工具：把已发布脚本暴露成受控工具，让 Agent 在 Toolset 范围内调用。


## 面向开发者的代码型编排

n8n、Dify、扣子这类拖拽式工具很适合快速把几个现成节点串起来，也适合非技术人员配置简单流程。它们的优势是直观，上手快，适合验证想法。

但很多自动化流程一开始很简单，后面会慢慢变复杂：条件分支越来越多，异常处理越来越细，依赖要复用，配置要区分环境，还要考虑版本、审计和代码评审。这时继续在画布里堆节点，维护成本会逐渐上来。

ActionDock 的定位不一样。它面向的是开发、运维、平台这类更习惯用代码表达逻辑的人，所以它的基础不是画布，而是脚本、Schema、插件和发布快照。

这也决定了它的复用方式不同：拖拽式平台复用的是节点；ActionDock 复用的是脚本和插件。脚本适合沉淀流程步骤、业务动作和编排逻辑，插件适合沉淀内部 SDK、系统接入和稳定底层能力。

| 场景 | 拖拽式工作流 | ActionDock |
|------|--------------|------------|
| 主要使用者 | 非技术人员、业务配置人员 | 开发、运维、平台人员 |
| 复用单元 | 节点 | 脚本和插件 |
| 复杂逻辑 | 画布容易变重 | 用代码表达 |
| 版本、审计、分发 | 依赖平台能力 | 脚本资产内建这些约定 |
| 给 AI Agent 调用 | 通常要再整理工具描述 | 直接基于 Schema 暴露工具 |

所以 ActionDock 不是要替代所有可视化编排工具，而是把那些最终会变成脚本、服务或内部工具的流程，放进一套更贴近开发者工作方式的工程体系里。


## 快速开始

安装并启动：

```bash
npm install -g actiondock
actiondock server
```

启动后访问 `http://localhost:5177/admin/app/scripts`。

跑一个内置示例：

```bash
actiondock script run hello-groovy --name alice --json
```

成功会看到：

```json
{
  "status": "SUCCESS",
  "output": {
    "message": "Hello, alice!",
    "upperName": "ALICE"
  }
}
```

接下来可以试试：

- 创建一个常用脚本，补充输入输出 Schema。
- 用 CLI 和管理台分别跑一下。
- 发布后加一个定时任务。
- 为不同环境配置 CLI profile。
- 把脚本发布到仓库。

## 总结

ActionDock 解决的不是“怎么写脚本”，而是“怎么让脚本长期可用、可复用、可治理”。

个人可以先把它当作统一管理脚本和自动化入口的平台来用；当使用范围扩大到多节点、多项目或多人协作时，它又能继续承接分发、审计、AI 工具化和治理这些需求。
