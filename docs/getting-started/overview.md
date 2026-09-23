# 系统概览与核心概念

ActionDock 2.x 写一次 Action，同时交付 CLI、MCP、HTTP 和 Agent Skill。

内置测试沙箱、状态存储、配置体系、运行追踪与可复现打包。

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

在代码绝大部分由智能体生成的时代，生成功能代码仅需数秒，工程落地真正的瓶颈在于确定性、安全防线与免维护交付：

- 避免裸脚本脆弱易崩：传统临时脚本缺乏规范的输入输出校验与环境隔离，容易因为依赖缺失或配置漂移而发生运行中断。
- 规避模型越权风险：如果仅把函数接口直接暴露给大模型，在复杂多步任务中，模型极易产生幻觉、颠倒调用时序甚至触发破坏性操作。
- 解决测试沙箱缺失痛点：依赖真实外部网络与数据库环境的测试脆弱缓慢，无法支撑智能体在受控内存环境中执行闭环验证与自主自愈。
- 消除重复适配开销：针对特定通信协议手写工具层，无法直接跨本地命令行、协议服务与智能体技能包无缝复用。

ActionDock 践行人定规程与智能体自主实现的工程协作范式：人类专家在操作规程中划定业务时序与安全底线，智能体依据强类型契约编写具体实现，并通过纯内存测试沙箱实现闭环自愈。

---

## 三大核心概念

ActionDock 围绕三个相互协同的核心概念构建：

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
  确定性的原子任务执行单元。每个 Action 负责一项明确的业务能力（如查询数据、调用外部服务或执行转换）。通过强类型接口与输入输出模式进行约束，确保输入合规与输出确定。
- 操作规程 Playbook：
  面向智能体的标准作业规程。采用纯 Markdown 编写，沉淀领域专家的作业步骤、前置依赖检查、判断分支与不可逾越的安全红线，防止智能体在复杂流程中越权脱轨。
- Agent 技能包：
  面向智能体的高级自包含交付资产。将原子 Action 与操作规程 Playbook 融为一体，生成包含规范入口的技能目录。智能体通过技能管理器安装后，能够自主索引规程并调度底层工具。

---

## 一份 Action，多形态交付

使用 ActionDock 编写的 Action，只需维护单一源码事实源，即可无缝交付为多种目标形态：

```text
actions/greet.ts（强类型 Action 业务源码）
       │
       ├── ad test         --> [PASS] 毫秒级纯内存沙箱测试
       ├── ad run          --> [OUTPUT] 本地命令行即时调用验证
       ├── ad mcp          --> [READY] 导出标准 MCP 协议通信服务
       ├── ad serve        --> [READY] 启动生产级 RESTful HTTP 微服务
       └── ad export skill --> [EXPORT] 打包自包含 Agent 技能包
```

- 本地命令行执行：使用 `ad run` 快速验证业务入参，输出标准响应信封，日志自动分流。
- 协议直连无缝适配：原生支持 Model Context Protocol，可在 Cursor、Windsurf 或 Claude Desktop 中一键挂载。
- 生产微服务部署：使用 `ad serve` 启动生产级 RESTful HTTP 接口，开箱即用。
- 智能体生态无缝集成：使用 `ad export skill` 导出标准技能包，主流智能体客户端开箱即用。

---

## 统一命令心智与渐进式架构

ActionDock 将日常开发链路收敛至 5 个核心命令：

- `ad init`：初始化项目脚手架与基础环境。
- `ad action create`：声明输入输出字段，自动生成 Action 骨架与强类型契约，完全隐藏手动编写模式定义的复杂度。
- `ad test`：执行毫秒级纯内存沙箱测试，零等待即时反馈。
- `ad run`：本地命令行即时调用与信封验证。
- `ad export skill` / `ad mcp` / `ad serve`：多形态即刻交付。

对于高级场景（如复杂模式约束扩展、多级配置管理、底层状态机与自包含运行时构建），系统通过进阶模块渐进展开，保持入门轻快与深度可控并存。

---

## 角色导航指引

根据你的实际需求，选择合适的阅读路径：

- 我是工具创作者或开发者：
  希望快速开发自己的 Action 与规程，请前往 [快速上手指南](quick-start.md) 与 [Action 核心模型与开发指南](../developer/first-action.md)。
- 我是工具使用者或智能体操作者：
  希望把现有包或技能在智能体或开发工具中用起来，请查阅 [消费接入选型总览](../consumer/overview.md)。
- 我想了解框架底层实现细节：
  深入探究底层状态机、并发配额与执行引擎，请查阅 [底层架构解密](../architecture/runtime.md)。
