# 把本地脚本变成 AI 也能调用的"工具"——ActionDock 的实践之道

> 你的脚本还在靠微信传文件？AI 调用靠 Prompt 反复横跳？
>
> 这篇文章介绍一种"一次定义，到处调用"的方案——CLI、管理台、REST API、定时任务、Webhook、AI Agent，六种入口共用一份 Schema。



## 痛点：脚本复用的噩梦

场景：Skill 里的脚本复制

假设有两个 AI Skill：

- Skill A：每日日报生成 → 需要调用"发邮件"脚本
- Skill B：异常告警推送 → 也需要调用"发邮件"脚本

一个朴素的实现方式是：分别在两个 Skill 里各写一段发邮件的代码，或者干脆复制一份"发邮件"脚本。

问题随之而来：

- 邮件 SMTP 配置改了？两处都得改
- 邮件模板调整了？两处都得同步
- 某天发现有个脚本有 Bug，修完后发现还有一个版本漏了

十个 Skill 里有八个要发邮件，就意味着八份散落在各处的邮件代码。维护成本指数增长。

场景：脚本传参的混乱

脚本写好了，大模型却经常传错参数——要么字段名对不上，要么类型不对，要么漏了必填字段。

你得花时间写一大段说明文档，不断调试才能保证大模型调用的成功率。



## 问题出在哪：缺的不是脚本，是标准约定

回到本质：脚本之所以难复用，不是代码写得不好，而是缺了一层标准约定。

一个可复用的脚本，必须能明确回答以下问题：

- 身份：Script ID 是什么？
- 输入：需要什么参数？类型是什么？（inputSchema）
- 输出：返回什么结果？（outputSchema）
- 依赖：依赖哪些外部资源？
- 版本：发布的稳定版本是什么？

能完整描述这五点的脚本，就不再只是一段源码——而是升级成了脚本资产（Script Definition）。

在 [ActionDock](https://github.com/team4u/actiondock) 项目中，一个脚本的定义长这样（摘自项目源码 `SampleDataInitializer.java`）：

```java
ScriptDefinition script = new ScriptDefinition()
    .setId("hello-groovy")                          // 唯一标识
    .setName("Hello Groovy")                        // 可读名称
    .setType(ScriptType.GROOVY)                     // 脚本类型
    .setSource("""
        def name = input.name ?: "World"
        return [message: "Hello, " + name + "!", upperName: name.toUpperCase()]
        """)
    .setInputSchema(Map.of(                         // 输入参数 Schema
        "type", "object",
        "properties", Map.of(
            "name", Map.of("type", "string", "title", "Name")
        )
    ))
    .setOutputSchema(Map.of(                        // 输出 Schema
        "type", "object",
        "properties", Map.of(
            "message", Map.of("type", "string", "title", "Message"),
            "upperName", Map.of("type", "string", "title", "Upper Name")
        )
    ));
```

这段代码不只是定义一个对象——它为脚本赋予了标准化接口：明确身份、声明输入输出、锁定版本。



## 一张 Schema，打通四个入口

`inputSchema` 和 `outputSchema` 采用标准 JSON Schema 格式。它最大的价值不是"写了什么"，而是定义一次，四处生效：

| 调用方 | Schema 怎么用 |
|--------|-------------|
| CLI | 自动展开为 `--name alice` 这样的命令行参数 |
| 管理台 | 自动生成参数填写表单 |
| AI Agent | 自动生成 Tool Description |
| 执行引擎 | 执行前自动校验参数格式 |

也就是说，只要定义好 Schema：CLI 不需要额外写参数解析，管理台不需要手写表单，AI 侧的 Tool 描述自动对齐。

更关键的是：Schema 是唯一的事实来源，不存在"AI 理解的参数和脚本实际参数不一致"的问题。再也不用手动维护两套约定，眼睁睁看着大模型传错参数了。



## 草稿与发布：脚本也有版本管理

ActionDock 把脚本生命周期分为两个状态：

```
草稿（DRAFT） → 发布（PUBLISHED）
     ↑              ↓
     └── 丢弃草稿 ──┘（回到上一个稳定版本）
```

- 草稿：随便改，用 `--draft` 参数执行草稿版调试
- 发布：冻结当前状态，生成不可变快照。定时任务、被调脚本、AI Agent 永远走 published 版本
- 丢弃草稿：一键回到上次发布版本，不用担心改坏


脚本互调时，被调脚本永远锁定在已发布快照上，不会被调用方的草稿影响。



## 一个脚本，六种入口

脚本定义好之后，可以从这些地方直接调用：

### CLI

```bash
actiondock script run hello-groovy --name alice --json
```

CLI 会自动根据 `inputSchema` 把参数展开成 flag。复杂参数用 `--input-file` 传入 JSON 文件。

创建 → 校验 → 调试 → 发布的完整闭环：

```bash
actiondock script create --script-id my-script --name "My Script" --type groovy --source-file ./script.groovy
actiondock script validate my-script
actiondock script run my-script --draft --input-json '{"name":"alice"}' --response-view debug
actiondock script publish my-script
actiondock script run my-script --name alice --json
```

### REST API

```bash
curl -X POST http://localhost:5177/api/scripts/hello-groovy/execute \
  -H 'Content-Type: application/json' \
  -d '{"input": {"name": "alice"}, "mode": "SYNC"}'
```

### 管理台

打开脚本库 → 点脚本 → 填自动生成的参数表单 → 点执行 → 看结果。支持「表单模式」和「JSON 模式」切换。

### 定时任务

在管理台配置 Cron 表达式，定时调用已发布脚本，自动记录每次执行的结果。

### Webhook

外部系统发请求 → 标准化处理 → 过滤匹配 → 执行脚本。四个阶段的管道保障事件处理的可靠性：

```
外部系统 → 事件源 → 标准化处理器 → 触发规则 → 执行脚本
                        │               │
                        │          ├── 过滤（要不要执行？）
                        │          ├── 幂等（去重）
                        │          └── 输入映射（转成脚本参数）
                        │
                     鉴权支持: NONE / HEADER_TOKEN / HMAC_SHA256
```

### AI Agent

脚本自动注册为 AI 工具。

已发布的 TOOL 类型脚本会自动注册到 `AiToolRegistry`，Agent 可以自主发现和调用这些脚本，不需要额外配置。

甚至还有一个反向生成机制：脚本写好后，平台可以一键生成 Skill 示例，包含 `scriptId`、执行模式、`inputSchema`、`outputSchema`、对应的 CLI 命令和可回退的 HTTP 调用方式。外部大模型可以直接使用。



## 跨语言透明调用：Groovy 调 Python，跟调本地函数一样

主业务用 Java/Groovy 写，但数据处理想用 Python 的生态库？以前得专门部署一个 Flask 微服务，写一堆 HTTP 请求和序列化代码。

ActionDock 内置了跨语言桥接，直接在 Groovy 脚本里无缝调用 Python 脚本，反过来也行。

```groovy
// Groovy 脚本里调 Python 脚本
def result = scripts.invoke("python-data-processor", [input: rawData])
```

```python
# Python 脚本里调 Groovy 脚本
result = scripts.invoke("groovy-report-generator", {"data": processedData})
```

通信机制很简洁：
- stdin：接收输入数据（JSON）
- stdout：输出执行结果（JSON）
- stderr：承载所有控制通信——日志、脚本互调、插件调用、状态操作

Python 子进程通过 stderr 发请求，Java 主进程解析后执行，再通过 stdin 写回响应。双方靠简单的字符串前缀协议完成跨进程 RPC，不需要任何微服务部署。

Groovy 脚本更直接——在 JVM 内编译执行，编译结果会被缓存，重复执行相同脚本不会重复编译。


## 插件系统：平台能力无限扩展，脚本侧一行调用

除了脚本间调用，ActionDock 还基于 PF4J 实现了完整的插件体系。插件不是脚本，而是打包了 Java 实现的独立扩展包，再复杂的能力也不过是一行 `plugins.invoke()`。

```groovy
// Groovy 脚本里调用 Java 插件
def result = plugins.invoke("my-plugin", "hello", [name: "world"])
```

```python
# Python 脚本里调用 Java 插件
result = plugins.invoke("my-plugin", "hello", {"name": "world"})
```

调用方不关心底层是 Java 插件还是 Groovy/Python 脚本——对脚本来说，`plugins.invoke()` 和 `scripts.invoke()` 的体验完全一致，能力本身比实现形式更重要。

每个插件通过 JSON 清单文件声明自己的身份、配置 Schema、支持的动作列表，每个动作都有自己的 `inputSchema` 和 `outputSchema`：

```json
{
  "pluginId": "my-plugin",
  "actions": [{
    "action": "hello",
    "title": "打招呼",
    "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } } }
  }]
}
```

插件的生命周期管理也配套到位：上传安装 → 启动/停止 → 升级（支持回滚）→ 卸载，全部通过管理台或 CLI 完成，不需要改主服务、不需要重新部署。当脚本需要访问外部系统、封装内部 SDK 或沉淀共用能力时，不需要把复杂逻辑都塞进脚本源码。


## 共享状态 + CAS：多脚本间的并发安全

跨脚本共享数据是另一个痛点。想在不同脚本之间共享一个计数器、令牌或运行状态？以前要么落文件，要么自建 Redis。

ActionDock 内置了共享状态机制，通过 `state` 门面对象操作：

```groovy
state.get("my-namespace", "my-key")                         // 读取
state.put("my-namespace", "my-key", [data: "value"])        // 写入
state.cas("my-namespace", "my-key", [data: "new"], 3)       // CAS：版本号为 3 才写入成功
```

CAS（Compare-And-Swap）乐观锁解决了一个很实际的并发问题：

> 两个定时任务同时触发，都要更新同一个状态。没有版本号保护的话，后写入的会覆盖前一个，导致数据丢失。有了 CAS，只有版本号匹配时才写入成功，失败了就重试。

```groovy
def current = state.get("cursor.sync", "users")
def result = state.cas("cursor.sync", "users", current?.version, [cursor: "next-token"])
if (!result.updated) {
    throw new IllegalStateException("共享状态版本冲突，请重试")
}
```


## 打破 Skill 孤岛：一个脚本改了，所有 Agent 自动受益

Skill A（发日报）和 Skill B（发告警）都需要发邮件。以前只能把"发邮件"脚本复制多份，换邮箱密码时需要同步修改多处。

ActionDock 的核心思路是动作与逻辑解耦：

- 所有底层能力（查数据库、发邮件、调 API）注册在 ActionDock，变成独立工具脚本
- 所有大模型和 Skill 只负责发调用指令，不关心具体实现
- 改一次底层脚本，所有 Agent 自动受益

## 平台级 AI 能力：不止是工具注册

前面提到脚本会自动注册为 AI 工具——但这只是冰山一角。ActionDock 内置了一套完整的 AI 能力层，大模型在平台内是一等公民，而不是外部旁路系统。

### 模型即配置

在管理台中，你可以直接定义 AI 模型配置（Model Profile），选择供应商和模型名称，关联 API Key：

| 支持的供应商 | 模型举例 |
|-------------|---------|
| OpenAI | gpt-4o / gpt-4o-mini |
| OpenAI Compatible | 任何兼容 OpenAI 接口的服务 |
| Anthropic | claude-sonnet-4 |
| Gemini | gemini-2.0-flash |
| Ollama | 本地部署的开源模型 |

配置保存后即可在脚本中通过 `actiondock-ai` 插件直接调用 AI：

```groovy
// 脚本里直接调用 AI，不需要自己写 HTTP 请求
def chatResult = plugins.invoke("actiondock-ai", "chat", [
    modelProfileId: "my-model",
    messages: [{ role: "user", content: "总结这段日志" }]
])

def structuredResult = plugins.invoke("actiondock-ai", "structured", [
    modelProfileId: "my-model",
    prompt: "提取邮件中的日期和金额",
    schema: { type: "object", properties: { date: { type: "string" }, amount: { type: "number" } } }
])
```

支持的能力类型：对话（chat）、结构化输出（structured）、向量嵌入（embedding）、Agent 运行（agentRun）。

### Agent 即配置

定义 Agent Profile——关联哪个模型、用什么 System Prompt、绑定哪些工具集和 Skill——保存即生效：

```
Agent Profile
├── 关联模型（Model Profile）
├── System Prompt
├── 工具集（Toolset）→ 一组脚本工具，按权限分组
├── Skills → 关联的 AI Skill 列表
└── 运行选项（maxIters 等）
```

工具集（Toolset）支持权限分级控制，从只读到危险操作，确保 AI 不能越权执行敏感脚本。

### 运行记录与审计

每次 AI 调用都会生成完整的运行记录：步骤追踪（Agent 每一步的思考/工具调用）、Token 用量统计、运行状态。还支持审批/中断流程，关键操作需要人工确认后才实际执行。



## 仓库分发：像用软件中心一样分享团队工具

团队分享脚本靠 Git 链接或发压缩包，满地都是带 Bug 的老版本？

ActionDock 的 Repository 机制让这件事变得像更新软件一样简单：

- 管理台 → 仓库发现 → 选择资源 → 点击安装
- 管理台 → 仓库发现 → 选择资源 → 一键批量更新


可分发的资产类型：脚本、插件、AI 能力包、Skills、事件源资产。

仓库的设计思路是"让工具能被他人发现和安装"。

## Skills 管理：从仓库发现，自动同步到你的 IDE

脚本和插件解决了"能力复用"的问题，但还有一件事：AI 编码助手需要 Skill（技能包）才能理解你的工具。ActionDock 的 Skills 管理模块，做的就是"把仓库里的能力装到 IDE 里"这件事。

### 一次安装，自动同步

从仓库发现一个 Skill → 点击安装 → 自动写入目标目录 → IDE 下次加载即生效：

```
仓库发现 Skill → 安装到目标目录 → 文件系统 → IDE / AI 客户端自动加载
```

支持的目标类型：
- CLAUDE：安装到 `~/.claude/skills`
- CODEBUDDY：安装到 `~/.codebuddy/skills`
- CODEX / GEMINI / ACTIONDOCK：其他 AI 编码工具
- CUSTOM：自定义任意目录

### 更新即同步

仓库里的 Skill 有更新时，不需要手动拷贝——管理台一键同步所有 Skill，系统会自动比对版本和摘要，把最新内容写入目标目录。

| 状态 | 说明 |
|------|------|
| INSTALLING | 安装中 |
| SUCCESS | 安装成功 |
| FAILED | 安装失败（可查看错误详情） |
| SKIPPED | 跳过（版本无变更） |

### 安装来源灵活

不仅限于仓库：你可以通过 GitHub 集合 URL 扫描选择、本地目录批量导入、ZIP 归档上传安装。无论是公开社区的共享 Skill，还是团队内部的私有技能包，都能统一纳管。

这套机制让 Skill 的分发不再是"发压缩包、手动解压到目录"的原始方式，而是像软件包管理器一样——发现、安装、更新，一气呵成。

## 治理基础设施：配置、令牌与备份一个不少

### 配置值管理

全局键值配置存储，写一次到处引用。API Key、连接字符串、SMTP 密码……统统存在这里：

- Secret 标记：标记为敏感的值，在管理台自动显示为 `********`，只有真正用到时才解密
- 占位符引用：脚本、插件配置里通过 `${config.my-api-key}` 引用配置值，不硬编码
- 仓库托管：从仓库安装的工具自带配置模板，本地可覆盖，更新时保留本地修改

### 访问令牌

管理台可以创建 Bearer Token，分配给不同使用方——CLI、外部系统、CI/CD 流程。令牌创建时显示一次，之后只能看到掩码。支持启用/禁用，随时吊销，不再需要共享密码。

### 数据备份

提供全量/增量备份，可含 Secret 明文（导出时按需选择），支持恢复预览和结果摘要。定时导出、升级前备份、迁移时恢复，一个接口全搞定。



## 技术架构总览

项目用了六边形架构（端口与适配器模式），核心领域层不依赖具体实现。

```
调用入口                    服务层                  引擎层
┌────────┐                ┌───────────┐          ┌──────────────┐
│REST API│──┐             │           │          │ ScriptEngine  │
├────────┤  │             │  Script   │          │   接口        │
│  CLI   │──┼────────────→│Invocation │─────────→│              │
├────────┤  │             │  Service  │          ├──────────────┤
│UI 手动 │──┤             │           │          │ GroovyEngine │
├────────┤  │             │           │          │ (JVM 内编译)  │
│Agent   │──┘             └───────────┘          ├──────────────┤
└────────┘                                       │ PythonEngine │
                                                 │ (子进程执行)  │
                                                 └──────────────┘
                                                        │
                                                 ┌──────┴──────┐
                                                 │ 上下文注入    │
                                                 │ plugins      │
                                                 │ scripts      │
                                                 │ state        │
                                                 │ config       │
                                                 │ log          │
                                                 └─────────────┘
```


## 快速上手

一条命令：

```bash
npm install -g actiondock && actiondock server
```

启动后访问 `http://localhost:5177/admin/app/scripts`，可以看到系统自带的示例脚本 `hello-groovy`。

用 CLI 跑一下：

```bash
actiondock script run hello-groovy --name alice --json
```

输出：

```json
{
  "status": "SUCCESS",
  "output": {
    "message": "Hello, alice!",
    "upperName": "ALICE"
  }
}
```

3 分钟就能跑通第一个脚本。之后你可以：

- 把常用脚本放进去，补几十行 Schema
- 通过 CLI / API / UI 三个入口调用
- 一键生成 Skill 示例，给 AI Agent 用
- 发布到仓库，让团队安装使用



## 你甚至不需要自己写脚本

前面讲了那么多手动创建脚本、定义 Schema、发布版本的操作——但你有没有想过：这些完全可以交给 AI 替你完成？

ActionDock 配套了一套专为 AI 编码助手设计的内置 Skill——actiondock-cli。它覆盖了脚本的完整生命周期：

整个过程，你只需要做一件事：告诉 AI 你想要什么。比如：

> "帮我创建一个每天早上 9 点发日报的 Groovy 脚本"

AI 就会自动走完"需求→源码→草稿→校验→调试→修复→发布"的完整闭环。你连一行 CLI 命令都不用敲，连一次管理台都不用打开。

—从零到上线，AI 一条龙搞定。



## 写在最后

ActionDock，让个人代码升级为可复用的团队资产。