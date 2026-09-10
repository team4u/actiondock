# 参考手册：架构演进与迁移指南

ActionDock 2.0 完成了从中心化平台向去中心化、轻量化、智能体原生工具链的全面重构。不仅彻底摆脱了 1.0 的复杂平台负担，还在 2.0 持续演进中确立了以 Node.js 24（版本大于等于 24.12.0）为核心运行时底座、严格代码库分层以及以 `actiondock.json` 为唯一事实源的新一代现代化架构。

---

## 运行时架构演进全貌

### 从中心化微服务到去中心化工具链

ActionDock 1.0 采用中心化服务架构，依赖常驻后台进程、关系型数据库和分布式配置中心，部署与运维成本高昂。2.0 彻底转向去中心化架构，将核心定位为面向 AI 智能体的原子 Action 与 Skill 资产开发、测试、构建与分发工具链，实现零常驻服务、按需运行。

### 统一 Node.js 运行时底座

在 2.0 目标架构中，运行时底座全面统一：

- 统一生产与测试底座：ActionDock 2.0 将生产底座与标准测试套件全面对齐至 Node.js 24（要求版本大于等于 24.12.0），充分利用 Node 原生类型擦除能力与 NodeNext 模块解析。
- 显式平台依赖注入：底层通过 `@actiondock/runtime-node` 适配层封装平台底层差异，消除全局运行时状态修改，将 Node 原生基础设施隔离在平台边界内。
- 目录型交付替代单文件二进制：构建交付（`ad build`）与技能导出（`ad export skill`）采用 Node.js 运行时交付目录或压缩归档，废弃原有的单文件独立二进制编译器。

### 代码库分层解耦体系

ActionDock 2.0 采用清晰的代码库分层结构，严格划分包职责：

- 极简公共契约层：[`@actiondock/sdk`](file:///root/code/action-dock/packages/sdk/src/index.ts)
  纯净轻量的公共契约包，零重型外部依赖。仅定义 `defineAction`、`ActionContext`、`ProcessAPI`、`Config`、`StateStore` 等核心抽象与 TypeScript 类型契约。
- 确定性测试框架层：[`@actiondock/testing`](file:///root/code/action-dock/packages/testing/src/index.ts)
  独立的测试运行框架。提供纯内存测试底座、虚拟时钟、命令模拟以及内存持久化存储。
- 公共领域内核层：[`@actiondock/core`](file:///root/code/action-dock/packages/core/src/index.ts)
  承载公共领域逻辑，包括项目元数据管理、Action 调度执行、SQLite 存储驱动、清单校验与独立运行入口。
- 构建规划与导出层：[`@actiondock/builder`](file:///root/code/action-dock/packages/builder/src/index.ts)
  负责声明式依赖选择规划、npm 打包（`ad pack`）、Node.js 交付构建与技能导出。
- 协议适配层：[`@actiondock/mcp`](file:///root/code/action-dock/packages/mcp/src/index.ts)
  负责 Model Context Protocol 协议适配，支持 STDIO 与 HTTP 两种通信传输通道。
- 运行时适配层：[`@actiondock/runtime-node`](file:///root/code/action-dock/packages/runtime-node/src/index.ts)
  提供基于专用存储工作线程的 SQLite 驱动、受管外部子进程执行器及异步文件系统。
- 命令行门面层：[`@actiondock/cli`](file:///root/code/action-dock/packages/cli/src/index.ts)
  统一的 CLI 工具门面，负责参数解析、标准信封格式渲染以及严谨的退出码管控。

### 声明式单一事实源机制

ActionDock 2.0 统一采用 `actiondock.json`（规范版本号为 2）作为元数据唯一事实源，配套 `actiondock.lock.json` 作为依赖锁定事实源：

- 彻底移除双清单机制：完全废弃并移除了早期的 `actiondock.manifest.json`，元数据、配置项定义、动作契约与规程索引全部收敛于 `actiondock.json`。
- 静态契约约束：清单显式记录每个 Action 的入口文件路径、输入模式规范、输出模式规范、静态依赖关系与检索标签。
- 锁文件完整性：`actiondock.lock.json` 记录外部依赖的精确版本与校验摘要，保证环境可复现性。

---

## 核心维度对比矩阵

| 维度 | ActionDock 1.0（旧版） | ActionDock 2.0（当前架构） |
| :--- | :--- | :--- |
| 架构形态 | 中心化微服务网关平台，需常驻后台进程 | 去中心化工具链，支持目录交付与按需调度 |
| 运行时底座 | Java 21、Spring Boot 3.3、JVM 虚拟机 | 统一 Node.js 24 生产与开发底座，支持原生类型擦除 |
| 契约形式 | 动态脚本，依赖运行时数据库反射 | defineAction 实现配合 actiondock.json 静态清单 |
| 依赖锁定 | 缺乏严格锁定机制 | 统一 actiondock.lock.json 锁定文件与版本约束 |
| 交付产物 | 庞大 Jar 包，目标环境必须预装 JDK | Node.js 运行时交付目录、npm 压缩包、源码与目录型技能 |
| 测试体系 | 依赖重量级容器上下文与外部测试数据库 | 独立测试包 @actiondock/testing，原生支持内存沙箱 |
| 进程治理 | 易发生流读取挂起与管道死锁 | 统一 ProcessAPI（仅 exec 与 spawn），受管进程树管控 |
| 通信通道 | 业务结果与日志混杂在标准输出流中 | 标准输出专供结构化 JSON 信封，日志定向写入标准错误流 |
| 存储引擎 | 外部 MySQL、PostgreSQL 或内存 H2 | 内嵌轻量 SQLite 引擎，原生支持生存时间与命名空间 |

---

## 编程范式演进对比

### 1.0 动态脚本范式

```groovy
// 依赖后台 Spring 容器与隐式全局注入
def targetHost = input.host ?: "127.0.0.1"
def cachedStatus = state.get("host_status_" + targetHost)
def apiKey = config.get("api.key")
def result = shell.exec("ping -c 1 " + targetHost)
log.info("Ping result: " + result)
return [host: targetHost, reachable: result.contains("1 packets transmitted, 1 received")]
```

### 2.0 现代 TypeScript Action 范式

```ts
import { defineAction } from "@actiondock/sdk";

export interface PingInput {
  host: string;
}

export interface PingOutput {
  host: string;
  reachable: boolean;
}

export default defineAction<PingInput, PingOutput>(async (input, ctx) => {
  ctx.log.info(`开始检测主机连通性: ${input.host}`);

  const cachedStatus = await ctx.state.get<boolean>(`host_status_${input.host}`);
  if (cachedStatus !== undefined) {
    return { host: input.host, reachable: cachedStatus };
  }

  const res = await ctx.process.exec("ping", ["-c", "1", input.host], {
    timeoutMs: 5000,
    signal: ctx.signal,
  });

  const reachable = res.ok && res.stdout.includes("1 packets transmitted, 1 received");
  await ctx.state.set(`host_status_${input.host}`, reachable, 60);

  return { host: input.host, reachable };
});
```

配套在 `actiondock.json` 中声明参数模式契约：

```json
{
  "schemaVersion": 2,
  "id": "sample.network-tools",
  "actions": {
    "ping-host": {
      "entry": "actions/ping-host.ts",
      "description": "检测指定主机的网络连通性",
      "inputSchema": {
        "type": "object",
        "properties": {
          "host": { "type": "string" }
        },
        "required": ["host"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "host": { "type": "string" },
          "reachable": { "type": "boolean" }
        },
        "required": ["host", "reachable"]
      }
    }
  }
}
```
