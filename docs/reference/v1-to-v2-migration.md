# 参考手册：1.0 到 2.0 架构对比与迁移指南

ActionDock 2.0 完成了向现代化、轻量化、Agent 原生架构的全面重构。从 1.0 的中心化微服务网关平台，演进为去中心化、全模态交付的 AI Agent 开发工具链与独立编译器。

---

## 核心维度对比与优势

| 维度 | ActionDock 1.0（旧版） | ActionDock 2.0（全新工具链） | 2.0 核心优势 |
| :--- | :--- | :--- | :--- |
| 系统形态 | 中心化微服务网关平台，常驻后台服务 | 去中心化工具链与独立编译器，按需运行 | 零常驻服务，零端口占用，开箱即用 |
| 技术栈与运行时 | Java 21、Spring Boot 3.3、JVM 运行时 | 原生 TypeScript 与 Bun 原生运行时 | 启动时间从 10 秒以上缩减至 20 毫秒以内，内存占用降低 90% |
| 工具契约与类型 | Groovy 或 Python 脚本，依赖数据库记录与注解 | defineAction 声明配合严格 JSON Schema | 静态类型推导配合运行时 Schema 自动强校验 |
| 编译与交付模态 | 庞大 Jar 包或依赖后端的 CLI，目标机需部署 JDK/Maven | 单文件独立二进制、Agent Skill、MCP 服务、HTTP 服务 | 支持 ad build 全平台交叉编译，目标机零环境依赖 |
| 测试与验证体系 | 依赖重量级 Spring 上下文与数据库迁移测试 | 纯内存沙箱测试 createTestRuntime | 单测耗时小于 5 毫秒，无磁盘与网络外部依赖 |
| 协议与智能体生态 | 私有 REST 接口与 WebSocket，CLI 依赖代理 | 原生 MCP 标准（STDIO 与 HTTP）及 Agent Skill 规范 | 无缝直连 Claude Code、Cursor、Windsurf 与 Antigravity |
| 规程化编排 | 任务手册与脚本混存数据库，逻辑耦合 | Action 原子能力与 Playbook 领域规程严格解耦 | 原子工具保证类型安全，规程沉淀业务经验与红线拦截，显著降低幻觉 |
| 进程与管道治理 | 基础进程调用，在复杂输出下易产生管道挂死 | 提供 execCli 与 spawnDetached，标准流严格物理隔离 | 标准输出专供结构化 JSON，日志定向标准错误，彻底杜绝死锁与流污染 |
| 存储与共享状态 | 外部 MySQL、PostgreSQL 或内存 H2 数据库 | 轻量内嵌式 SQLite 引擎（bun:sqlite） | 零运维依赖，支持命名空间隔离与秒级自动过期 |
| 资产与版本协作 | 数据库中心化存储，依赖快照，与 Git 割裂 | Git 原生纯文本代码（.ts、.md、.json） | 天然适配代码分支、合并评审与持续集成自动化 |
| 工作区与环境诊断 | 依赖管理控制台配置能力列表 | ad link 动态扫描、ad info 意图发现与 ad doctor 体检 | 自动感知工作区子包，内置全套环境诊断与健康体检 |

---

## 编程范式演进对比

### 1.0 动态脚本示例（Groovy）

```groovy
// 依赖后台 Spring 容器与隐式上下文
def targetHost = input.host ?: "127.0.0.1"
def cachedStatus = state.get("host_status_" + targetHost)
def apiKey = config.get("api.key")
def result = shell.exec("ping -c 1 " + targetHost)
log.info("Ping result: " + result)
return [host: targetHost, reachable: result.contains("1 packets transmitted, 1 received")]
```

### 2.0 现代 TypeScript Action 示例

```ts
import { defineAction, execCli } from "@actiondock/sdk";

export default defineAction({
  id: "ping-host",
  description: "检测主机连通性",
  inputSchema: {
    type: "object",
    properties: { host: { type: "string" } },
    required: ["host"],
  },
  async run(input, ctx) {
    const cached = await ctx.state.get(`status:${input.host}`);
    const res = await execCli("ping", ["-c", "1", input.host], { signal: ctx.signal });
    ctx.log.info("探针执行完成", { exitCode: res.exitCode });
    const reachable = res.exitCode === 0;
    await ctx.state.set(`status:${input.host}`, { reachable }, 300);
    return { host: input.host, reachable };
  },
});
```

### 2.0 纯内存单测示例（毫秒级验证）

```ts
import { test, expect } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import pingAction from "../actions/ping-host";

test("ping-host 内存验证", async () => {
  const runtime = createTestRuntime();
  const res = await runtime.invoke(pingAction, { host: "127.0.0.1" });
  expect(res.ok).toBe(true);
});
```

---

## AI 原生自动化迁移指导

ActionDock 2.0 具备严格契约与标准化结构，无需人工手动逐行重写代码。通过挂载 2.0 技能库，可由 AI Agent 端到端自动复刻：

- **读取旧版资产**：让 AI Agent 直接读取 1.0 仓库中的 Groovy/Python 脚本、插件或旧版 Playbook。
- **挂载 2.0 技能**：为 AI Agent 挂载 ActionDock 2.0 技能文档（`skills/actiondock/SKILL.md`）。
- **指令智能复刻**：发送迁移 Prompt，自动转换为 TypeScript `defineAction`，完善 Schema 契约并规范为 `execCli` 或 `spawnDetached`。
- **内存单测验证**：自动编写 `tests/*.test.ts`，借助 `createTestRuntime` 执行 `bun test` 验证契约。
- **独立编译交付**：执行 `ad build` 编译为全平台单文件二进制，或通过 `ad export skill` 导出为 Agent Skill。

### 迁移 Prompt 参考模板

```text
你是一个精通 ActionDock 2.0 规范的资深工程师。
请读取 1.0 的旧版代码：<粘贴 1.0 脚本代码或文件路径>

请遵循 ActionDock 2.0 规范重构为全新 Action Package：
- 使用 defineAction 声明 Action，严格配置 inputSchema 与 outputSchema；
- 声明 TypeScript 强类型接口，外部命令使用 execCli 或 spawnDetached；
- 状态持久化改用 ctx.state，配置读取改用 ctx.config，日志输出使用 ctx.log；
- 耗时流程接入 ctx.signal 响应中断，复杂规程剥离至 playbooks/<name>.md；
- 编写配套的 tests/<name>.test.ts，通过 createTestRuntime 验证并确保 bun test 通过。
```

---

## 迁移后验收命令速查

- 单元测试：`bun test`
- 契约校验：`ad action validate <action-id>`
- 环境体检：`ad doctor`
- 本地执行：`ad run <action-id> --input '<json>'`
- 智能体直连：`ad mcp`
- 独立二进制构建：`ad build -t <target>`
- 导出技能包：`ad export skill`
