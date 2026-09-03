# 参考手册：1.0 到 2.0 架构对比与迁移指南

ActionDock 2.0 完成了向现代化、轻量化、Agent 原生架构的全面重构。从 1.0 的中心化微服务网关平台，演进为去中心化、全模态交付的 AI Agent 专用开发工具链与独立编译器。

---

## 核心架构演进背景

在 1.0 时代，ActionDock 采用典型的 Java 企业级架构：依赖 Spring Boot 运行时、JPA 关系型持久化、React 管理控制台以及常驻后台服务。开发者在定义脚本或插件后，必须启动庞大的后端服务，通过网络接口或管理控制台执行与分发。

随着大模型与 Agent 技术的爆发，智能体工具逐渐演化为独立的软件工程资产。工具不再需要沉重的服务底座，而是需要强类型契约、瞬时启动、自包含交付、纯内存单测以及与标准协议（如 MCP）和 Agent Skill 的无缝融合。

ActionDock 2.0 彻底摒弃了中心化服务的历史包袱，基于 Bun 原生运行时与 TypeScript 进行了全链路重构，确立了“一次编写，全模态交付”的架构理念。

---

## 核心架构维度深度对比

| 架构维度 | ActionDock 1.0（旧版） | ActionDock 2.0（全新工具链） |
| :--- | :--- | :--- |
| 架构定位 | 中心化微服务网关与集中式平台 | 分布式 AI Agent 工具链与独立编译器 |
| 技术栈与运行时 | Java 21、Spring Boot 3.3、JVM 运行时 | 原生 TypeScript 与 Bun 原生运行时 |
| 资源占用与冷启动 | 内存占用高（通常 500MB 以上），冷启动缓慢（10 至 30 秒） | 极致轻量（通常数十兆内存），瞬时冷启动（小于 20 毫秒） |
| 服务依赖 | 必须常驻后台守护进程（默认监听 5177 端口） | 零常驻服务，开箱即用，按需运行，无端口冲突 |
| 工具定义形态 | Groovy 或 Python 脚本，依赖数据库记录与注解 | 使用 defineAction 声明，JSON Schema 代码即契约 |
| 类型安全 | 运行时弱类型或鸭子类型推断 | 静态类型推导配合严格运行时 Schema 校验 |
| 交付与分发模态 | 庞大 Jar 包、War 包或需连接后端的 CLI 工具 | 单文件独立可执行文件、Agent Skill、MCP 服务、HTTP 服务 |
| 目标运行环境要求 | 目标宿主机必须安装 JDK 21、Maven 或 Node.js 运行时 | 编译后单文件零依赖，目标宿主机无需安装 Node.js、Bun 或 Java |
| 交叉编译支持 | 不支持二进制交叉编译 | 支持通过 target 参数编译为 Linux、macOS、Windows 各架构原生二进制 |
| 编译优化 | 依赖传统构建打包，无原生字节码预编译 | 默认开启 bytecode 预编译与 minify 代码精简，兼顾启动性能与源码保护 |
| 测试与验证体系 | 依赖重量级 Spring 上下文与测试数据库（耗时大于 10 秒） | 纯内存沙箱测试 createTestRuntime，无磁盘与网络开销（小于 5 毫秒） |
| 协议与生态集成 | 私有 REST 接口与 WebSocket，CLI 依赖中转代理 | 原生支持 MCP 协议（STDIO 与 HTTP）及 Agent Skill 规范 |
| 规程化编排 | 任务手册依赖数据库表存储，与执行引擎耦合 | 能力与规程解耦，Action 负责原子执行，Playbook 沉淀领域规程 |
| 进程与管道治理 | 简易进程调用，在长耗时与复杂输出下易发生管道挂起 | 提供 execCli 与 spawnDetached，配合标准输出错误物理流隔离与信号取消 |
| 存储与共享状态 | 外部 MySQL、PostgreSQL 或内存 H2 关系型数据库 | 轻量内嵌式 SQLite 引擎（bun:sqlite），零运维且支持秒级自动过期 |
| 资产组织与版本控制 | 数据库中心化存储，版本依赖数据库快照，与 Git 割裂 | Git 原生架构，文件即资产，天然适配分支、合并评审与持续集成 |
| 多包与工作区治理 | 依赖管理控制台维护能力列表 | 支持 ac link 工作区动态扫描、ac info 意图模糊发现与跨包路由 |
| 环境诊断与体检 | 无内置系统体检工具，排错定位成本高 | 内置 ac doctor，一键检测运行时、存储引擎、注册表与项目依赖 |

---

## 2.0 核心优势与技术突破

- **极致轻量与零守护进程开销**：彻底移除了庞大的 JVM 堆栈、Spring Boot 容器以及常驻 5177 端口的后台服务。所有操作均为即开即用、按需唤醒的命令行工具链，执行完毕即释放系统资源，无后台常驻内存占用与端口冲突烦恼。
- **单文件零依赖独立编译交付**：通过 `ac build` 支持一键编译为包含全部逻辑与运行时的自包含单文件二进制程序。支持全平台交叉编译（覆盖 Linux、macOS 与 Windows 各主流架构），目标宿主机无需预装 Bun、Node.js、Java 或任何运行环境。默认开启字节码预编译与代码压缩混淆，在提供毫秒级冷启动的同时保护业务源码安全。
- **全模态交付与 Agent 原生输出**：同一份 Action 源代码，无需修改任何业务逻辑即可按需切换交付形态：
  - 命令行本地执行：通过 `ac run` 直接在终端中调用与调试。
  - 标准 MCP 服务直连：通过 `ac mcp` 启动 STDIO 或 HTTP 服务，直接为 Claude Code、Cursor、Windsurf、Antigravity 等主流工具提供协议级调用。
  - 远程微服务调度：通过 `ac serve` 快速启动轻量 HTTP 调度端点，满足远程异步执行需求。
  - 自包含 Agent Skill 导出：通过 `ac export skill` 将原子能力与配套操作规程打包为标准技能资产，大模型即插即用。
- **能力与规程严格解耦**：明确区分“智能体能做什么（Action）”与“智能体该怎么做（Playbook）”。Action 保证确定性、强类型与严格入参校验；Playbook 沉淀专家经验、红线拦截与多步作业顺序，形成完整 Action Package，有效降低智能体幻觉。
- **严密物理通道隔离与进程安全**：
  - 标准流物理隔离：标准输出严格受保护，仅用于输出机器可读的 JSON 信封或协议数据；所有执行日志与诊断跟踪统一导向标准错误，杜绝非结构化日志污染解析流。
  - 防管道死锁机制：普通同步外部调用使用 `execCli` 一次性排空管道缓冲区并关闭句柄；针对常驻或后台守护进程调用提供 `spawnDetached`，解耦标准输入输出并引入就绪轮询探测，彻底根绝进程挂死问题。
  - 取消链路直通：内置 `ctx.signal` 支持，当外部调用方发起中断或客户端断开连接时，能够迅速感知并中止执行。
- **纯内存毫秒级沙箱测试**：SDK 原生提供 `createTestRuntime` 测试工具，开发者可在不产生任何磁盘文件、无需连接数据库、无需模拟网络环境的前提下，完成配置读取、状态读写、多 Action 级联调用的全链路验证，单个测试用例耗时通常在 5 毫秒以内。
- **Git 原生协作与资产透明化**：所有 Action、Playbook 和配置文件均以纯文本文件形式保存在代码库中。版本迭代完全遵循 Git 工作流，支持分支开发、差异比对、代码审查与持续集成，彻底告别旧版数据库记录难以审查和追踪的弊端。
- **内嵌式零运维存储与多层配置**：内置高性能 SQLite 引擎，自动处理命名空间隔离与按秒过期的生存时间策略。配置解析支持多层回退机制（命令行参数、本地与全局存储、环境变量、配置文件），兼顾灵活性与安全性。
- **智能工作区与健康体检**：
  - 工作区自动感知：`ac link` 支持工作区容器目录，自动识别并动态挂载目录下新增的子包，无需频繁重新注册。
  - 意图模糊探索：`ac info` 支持通过自然语言意图模糊搜索已注册的包、Action 与规程，辅助智能体自主发现能力。
  - 一键系统体检：`ac doctor` 全面覆盖环境运行时、SQLite 读写、全局注册表与项目依赖检测，提供自动化修复建议。

---

## 核心概念与架构映射对照

| 1.0 概念与架构实现 | 2.0 对应概念与推荐形态 | 演化要点与重构说明 |
| :--- | :--- | :--- |
| Groovy 或 Python 脚本资产 | TypeScript Action 模块 | 使用 defineAction 声明，利用 TypeScript 与 JSON Schema 实现端到端静态与动态强类型保护 |
| 数据库已发布快照 | Action Package 目录与 Git 标签 | 工具资产纯文本化，依赖 Git 提交记录与语义化版本管理，无需通过管理端点击发布 |
| PF4J Java 插件 (JAR) | 标准 TypeScript 模块或独立 Action | 告别复杂类加载器隔离，直接使用标准 npm 模块或将能力独立拆分为清晰的 Action 单元 |
| scripts.invoke 脚本互调 | ctx.actions.invoke 互调接口 | 提供上下文受控的 Action 互调，内置调用栈深检测，防止无限递归与循环调用 |
| state.get 与 state.put 共享状态 | ctx.state.get 与 ctx.state.set | 依赖内置 SQLite 引擎，原生支持命名空间隔离与基于秒的存活时间自动过期 |
| config.get 配置读取 | ctx.config.get 配置读取 | 遵循 CLI 参数、SQLite 存储、环境变量、配置文件的清晰优先级解析链 |
| log.info 与 log.warn 日志输出 | ctx.log.info 与 ctx.log.warn | 日志流严格定向至标准错误，确保不干扰标准输出的机器解析 |
| shell.exec 命令行调用 | execCli 与 spawnDetached | 区分同步执行与后台守护进程执行，内置超时防护与标准流排空，避免死锁 |
| 数据库存储的任务手册 | playbooks 目录下的纯文本 Markdown | 遵循标准 Playbook 规范，包含目标说明、前置校验、标准作业步骤与异常处理红线 |
| Admin UI 管理控制台 | 现代化 CLI 工具链与 IDE 插件集成 | 依靠 ac 命令行、MCP 协议集成以及 IDE 智能体直接调度，无需沉重的可视化管理后台 |
| 需连接后台的 actiondock mcp | 原生进程内直连 ac mcp | 不再依赖 5177 端口与后台服务，作为独立子进程直接与智能体宿主通过 STDIO 通信 |

---

## 编程范式演进对比

### 1.0 旧版动态脚本示例（Groovy）

在 1.0 中，脚本依赖隐式注入的全局变量，缺少编译期类型检查，输入参数校验需要编写额外逻辑：

```groovy
// 1.0 脚本代码，依赖后台 Spring 容器解析与入库
def targetHost = input.host ?: "127.0.0.1"
def timeout = input.timeout ?: 5000

// 读写共享状态与配置
def cachedStatus = state.get("host_status_" + targetHost)
def apiKey = config.get("api.key")

// 执行外部命令
def result = shell.exec("ping -c 1 " + targetHost)

log.info("Ping result: " + result)

// 返回无类型约束的 Map 结构
return [
    host: targetHost,
    reachable: result.contains("1 packets transmitted, 1 received"),
    timestamp: System.currentTimeMillis()
]
```

### 2.0 现代 TypeScript Action 示例

在 2.0 中，使用 `defineAction` 进行契约化声明，输入输出均具备强类型与自动 Schema 校验，上下文明确且受控：

```ts
import { defineAction, execCli } from "@actiondock/sdk";

interface PingInput {
  host: string;
  count?: number;
}

interface PingOutput {
  host: string;
  reachable: boolean;
  timestamp: number;
}

export default defineAction<PingInput, PingOutput>({
  id: "ping-host",
  description: "检测指定主机的连通性状态",

  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string", description: "目标主机域名或 IP 地址" },
      count: { type: "integer", default: 1, description: "发送探针报文数量" },
    },
    required: ["host"],
  },

  outputSchema: {
    type: "object",
    properties: {
      host: { type: "string" },
      reachable: { type: "boolean" },
      timestamp: { type: "integer" },
    },
    required: ["host", "reachable", "timestamp"],
  },

  async run(input, ctx) {
    const count = input.count ?? 1;

    // 读取多层配置与持久化状态
    const apiKey = ctx.config.get<string>("apiKey", "");
    const cachedStatus = await ctx.state.get(`status:${input.host}`);

    // 使用安全封装的外部 CLI 调用，杜绝管道死锁
    const cliResult = await execCli("ping", ["-c", String(count), input.host], {
      signal: ctx.signal,
    });

    // 结构化日志自动重定向至标准错误，保障标准输出纯净
    ctx.log.info("探针执行完成", { exitCode: cliResult.exitCode });

    const reachable = cliResult.exitCode === 0;

    // 状态写入内嵌 SQLite，支持秒级 TTL
    await ctx.state.set(`status:${input.host}`, { reachable }, 300);

    return {
      host: input.host,
      reachable,
      timestamp: Date.now(),
    };
  },
});
```

### 2.0 纯内存单测编写示例

得益于 `createTestRuntime`，无需搭建任何测试数据库或模拟复杂服务器：

```ts
import { test, expect } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import pingAction from "../actions/ping-host";

test("ping-host 应能正确完成探针逻辑与状态缓存", async () => {
  // 初始化纯内存测试沙箱
  const runtime = createTestRuntime({
    config: { apiKey: "test-token" },
  });

  // 直接在内存中执行 Action 并获得执行信封
  const result = await runtime.invoke(pingAction, {
    host: "127.0.0.1",
    count: 1,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.host).toBe("127.0.0.1");
    expect(result.data.reachable).toBe(true);
  }

  // 验证状态是否正确写入内存存储
  const cached = await runtime.state.get("status:127.0.0.1");
  expect(cached).toBeDefined();
});
```

---

## 迁移指导：AI 原生自动化重构

由于 ActionDock 2.0 具备标准化的代码契约与严谨的接口规范，从 1.0 版本迁移无需人工逐行手动翻译代码。借助 AI Agent 协同与 2.0 技能库，可实现端到端的一键全自动复刻。

### 自动化迁移重构工作流

- **读取 1.0 旧版资产**：让 AI Agent 直接读取 1.0 代码库或分支中的 Groovy、Python 脚本文件、插件源码、SQL 初始化配置或旧版 Playbook 描述。
- **挂载 2.0 开发者技能**：为 AI Agent 挂载 ActionDock 2.0 技能文档（`skills/actiondock/SKILL.md`），使 Agent 掌握 2.0 架构全景认知、API 规范与编译导出指令。
- **指令触发智能转换**：向 Agent 发送结构化迁移 Prompt，要求其将旧逻辑转换为 TypeScript 模块，补充完整的 `inputSchema` 与 `outputSchema`，并将外部调用规范为 `execCli` 或 `spawnDetached`。
- **自动编写配套内存测试**：让 Agent 依据功能边界编写对应的 `tests/*.test.ts` 测试文件，通过 `createTestRuntime` 注入配置与状态，执行 `bun test` 验证。
- **执行本地校验与编译分发**：测试通过后，通过 `ac action validate` 完成契约校验，并根据需要通过 `ac build` 编译为跨平台独立二进制，或通过 `ac export skill` 导出为 Agent Skill。

### 自动化迁移 Prompt 参考模板

```text
你是一个精通 ActionDock 2.0 规范的资深工程师。
请仔细分析以下 ActionDock 1.0 的旧版代码与配置：
<粘贴 1.0 旧版 Groovy / Python 脚本内容，或提供 1.0 分支中的文件相对路径>

请根据 ActionDock 2.0 规范将其重构为全新 TypeScript Action Package：
- 工具定义：使用 defineAction 声明 Action，严格配置 inputSchema 与 outputSchema；
- 类型保障：声明完整的 TypeScript 输入与输出接口，确保强类型推导；
- 外部进程安全：外部命令行调用一律使用 execCli 或 spawnDetached，防止管道缓冲区死锁；
- 上下文适配：持久化状态改用 ctx.state（异步操作），配置读取改用 ctx.config，日志输出使用 ctx.log；
- 信号支持：在耗时操作中接入 ctx.signal 以支持取消机制；
- 规程剥离：若包含复杂的业务步骤或红线策略，请将其提炼至 playbooks/<name>.md；
- 沙箱单测：编写配套的 tests/<name>.test.ts，使用 createTestRuntime 进行毫秒级纯内存断言；
- 验证流程：确保可通过 bun test 测试与 ac action validate 校验。
```

---

## 迁移后验收与诊断核对清单

完成功能重构后，可通过以下工具链命令完成全生命周期质量验收：

- **运行内存测试套件**：执行 `bun test`，确保所有 Action 在纯内存沙箱中测试通过。
- **校验工具契约规范**：执行 `ac action validate <action-id>`，验证 JSON Schema 与元数据合规性。
- **执行环境与健康体检**：执行 `ac doctor`，检测本地运行时、SQLite 引擎、全局注册表与依赖健康度。
- **本地试跑与结果校验**：执行 `ac run <action-id> --input '<json>'`，观察标准输出中的 JSON 结果信封及标准错误中的日志。
- **智能体接入联调**：执行 `ac mcp` 开启 STDIO 服务，在 Cursor 或 Claude Code 中进行端到端工具调用验证。
- **独立可执行文件构建**：执行 `ac build -t <target>`，验证交叉编译独立二进制能否在脱离运行时的情况下独立执行。
- **导出并分发 Agent Skill**：执行 `ac export skill`，将原子工具与 Playbook 打包为便携式技能资产。
