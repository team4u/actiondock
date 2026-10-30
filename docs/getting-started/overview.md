# 系统概览与核心概念

ActionDock 2.x 编写一次 Action，同时交付 CLI、MCP、HTTP 和 Agent Skill。

框架内置测试沙箱、状态存储、配置体系、执行追踪与可复现打包。

```text
$ npm install -g @actiondock/cli
$ ad init hello && cd hello
[OK] Initialized ActionDock project in hello

$ ad action create greet --input name:string --output message:string
[OK] Created action greet (actions/greet.ts)
[OK] Generated contract types (.actiondock/generated/actions.d.ts)

$ ad test
[PASS] tests/greet.test.ts (1.2ms, in-memory sandbox)
1 passed, 0 failed

$ ad run greet -- name=World
{
  "ok": true,
  "runId": "01JMB394K8V6C1T9A2",
  "data": { "message": "Hello, World!" }
}

$ ad mcp          --> [READY] Model Context Protocol (STDIO/SSE)
$ ad serve        --> [READY] RESTful HTTP Microservice (:8080)
$ ad export skill --> [EXPORT] Self-contained Agent Skill bundle
```

---

## 为什么需要 ActionDock

智能体生成代码仅需数秒。工程落地的瓶颈在于确定性、安全防线与免维护交付：

- 避免临时脚本脆弱易崩：传统临时脚本缺少输入输出检查。环境隔离不足时，依赖缺失或配置漂移容易导致中断。
- 规避模型越权风险：如果把接口直接暴露给大模型，模型在复杂流程中容易产生幻觉。模型可能颠倒调用顺序，甚至执行破坏性操作。
- 解决测试沙箱缺失痛点：真实网络与数据库测试速度慢且不稳定。受控内存测试环境支持智能体验证与自愈。
- 消除重复适配开销：针对单一协议手写工具层。无法直接跨命令行、协议服务与智能体技能复用。

ActionDock 践行人定规程与智能体自主实现的协作范式。人类专家在操作规程中划定业务顺序与安全底线。智能体依据强类型契约编写实现，并通过纯内存测试沙箱自愈。

---

## 三大核心概念

ActionDock 围绕三个核心概念构建：

```text
Playbook 规程 ──── 人定规程（时序约束、分支判断、安全红线）
      │
      ▼
Action 动作   ──── Agent 实现（强类型契约、确定性执行、纯内存单测）
      │
      ▼
Skill 技能资产 ──── 自包含交付（面向智能体打包，自动引导环境就绪）
```

- 原子 Action：
  确定性的原子任务执行单元。每个 Action 负责一项明确业务能力，例如查询数据、调用外部服务或转换格式。强类型接口与模式约束参数，确保输入合规与输出确定。
- 操作规程 Playbook：
  面向智能体的标准作业规程。文件采用纯 Markdown 编写。它沉淀专家的作业步骤、前置检查、分支与安全红线，防止越权。
- Agent 技能包：
  面向智能体的自包含交付资产。框架将原子 Action 与操作规程 Playbook 结合，生成规范的技能目录。智能体安装技能后，可自主检索规程并调度工具。

---

## 一份 Action，多形态交付

编写 Action 后，只需维护单一源码，即可交付为多种目标形态：

```text
actions/greet.ts（强类型 Action 业务源码）
       │
       ├── ad test         --> [PASS] 毫秒级纯内存沙箱测试
       ├── ad run          --> [OUTPUT] 本地命令行即时调用验证
       ├── ad mcp          --> [READY] 导出标准 MCP 协议通信服务
       ├── ad serve        --> [READY] 启动生产级 RESTful HTTP 微服务
       └── ad export skill --> [EXPORT] 打包自包含 Agent 技能包
```

- 本地命令行执行：执行 `ad run` 验证入参，输出标准响应信封，日志自动分流。
- 协议直连适配：原生支持 Model Context Protocol，可在 Cursor、Windsurf 或 Claude Desktop 中挂载。
- 生产微服务部署：执行 `ad serve` 启动生产级 RESTful HTTP 接口，开箱即用。
- 智能体生态集成：执行 `ad export skill` 导出标准技能包，主流智能体客户端开箱即用。

---

## 统一命令心智与渐进式架构

ActionDock 将日常开发链路收敛至 5 个核心命令：

- `ad init`：初始化项目脚手架与基础环境。
- `ad action create`：声明输入输出字段，自动生成 Action 骨架与强类型契约。
- `ad test`：执行纯内存沙箱测试，毫秒级反馈。
- `ad run`：本地命令行即时调用与信封验证。
- `ad export skill`、`ad mcp`、`ad serve`：多形态即刻交付。

系统通过进阶模块支持复杂模式约束、多级配置管理、状态机与自包含运行时构建。

---

## 角色导航指引

根据实际需求选择阅读路径：

- 工具创作者或开发者：
  开发 Action 与规程，请前往 [快速上手指南](quick-start.md) 与 [Action 核心模型与开发指南](../developer/first-action.md)。
- 工具使用者或智能体操作者：
  在智能体或开发工具中使用包或技能，请查阅 [消费接入选型总览](../consumer/overview.md)。
- 了解框架底层实现细节：
  探究状态机、并发配额与执行引擎，请查阅 [底层架构解密](../architecture/runtime.md)。
