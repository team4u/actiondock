# 参考手册：1.0 到 2.0 架构演进与迁移指南

ActionDock 2.0 完成了从中心化平台向去中心化、轻量化、智能体原生工具链的全面重构。不仅彻底摆脱了 1.0 的 Java 与微服务网关平台负担，还在 2.0 持续演进中确立了以 Node.js 24 LTS 为核心生产底座、外部编译器解耦、严格代码库分层以及静态清单事实源的新一代现代化架构。

---

## 运行时架构演进全貌

### 从中心化微服务到去中心化工具链

ActionDock 1.0 采用中心化服务架构，依赖常驻后台进程、关系型数据库和分布式配置中心，部署与运维成本高昂。2.0 彻底转向去中心化架构，将核心定位为面向 AI 智能体的原子 Action 与 Skill 资产开发、测试、构建与分发工具链，实现零常驻服务、按需运行。

### 从强依赖 Bun 到默认 Node.js 24 LTS 生产底座

在 2.0 架构演进中，运行时底座经历了一次重要演进：

- **生产底座对齐**：早期的轻量化探索深度依赖特定运行时。为了满足企业生产环境对长期支持、生态稳定性和跨平台兼容性的要求，ActionDock 2.0 将默认生产底座与标准测试套件全面对齐至 Node.js 24 LTS。
- **运行时驱动解耦**：底层通过 `@actiondock/runtime-node` 与 `@actiondock/runtime-bun` 适配器抹平运行时差异。开发者既可以在日常开发中使用标准的 Node.js 环境，也可以在兼容环境下利用 Bun 获得极速冷启动体验。
- **外部编译器解耦**：构建单文件独立二进制（`ad build`）与独立 Skill 产物时，框架不再要求日常开发环境强绑定编译器，而是将单文件编译任务交由外部编译器组件 `BunCompiler` 独立调用，实现开发、测试底座与产物编译交付的完全解耦。

### 代码库分层解耦体系

ActionDock 2.0 采用清晰的代码库分层结构，严格划分包职责，杜绝循环依赖与冗余耦合：

- **极简公共契约层**：`@actiondock/sdk`
  纯净轻量的公共契约包，零重型外部依赖。仅定义 `defineAction`、`ActionContext`、`ProcessAPI`、`Config`、`StateStore` 等核心抽象与 TypeScript 类型契约。
- **确定性测试框架层**：`@actiondock/testing`
  独立的测试运行框架。解耦于核心执行器，提供 `createTestRuntime`、`FakeClock` 虚拟时钟、`MockProcessExecutor` 命令模拟以及 `MemoryStorage` 内存持久化，全面支持原生 `node:test` 与 `tsx`。
- **公共领域内核层**：`@actiondock/core`
  承载公共领域逻辑，包括项目元数据管理、Action 调度器 `ActionRunner`、SQLite 存储驱动、清单校验与独立运行入口。
- **构建规划与导出层**：`@actiondock/builder`
  负责构建规划与双模态产物导出。包含纯声明式静态依赖裁剪器 `BuildPlanner`、外部二进制编译器 `BunCompiler` 以及 Skill 打包器 `SkillExporter`。
- **协议适配层**：`@actiondock/mcp`
  负责 Model Context Protocol 协议适配，支持 STDIO 与 HTTP 微服务两种通信传输通道。
- **运行时适配层**：`@actiondock/runtime-node` 与 `@actiondock/runtime-bun`
  抹平操作系统信号、进程管道与底层驱动差异的适配层。
- **命令行门面层**：`@actiondock/runtime-cli` 与 `@actiondock/cli`
  统一的 CLI 工具门面，负责参数解析、标准信封格式渲染以及严谨的退出码管控。

### 静态清单事实源机制

ActionDock 2.0 全面引入 `actiondock.manifest.json` 作为单一事实源：

- **杜绝动态代码执行风险**：在进行依赖拓扑分析、构建闭包裁剪、工具发现与 MCP 映射时，工具链仅需读取静态 JSON 清单，绝不执行任何 Action 的 TypeScript 源码，杜绝副作用与安全漏洞。
- **声明式契约约束**：清单显式记录每个 Action 的文件入口路径、输入模式规范、输出模式规范、静态依赖关系（`uses`）与检索标签。
- **双向契约维护**：通过 `ad action create <id>` 脚手架创建 Action 时，自动生成代码模板并同步向清单注册契约条目。

---

## 核心维度对比矩阵

| 维度 | ActionDock 1.0（旧版） | ActionDock 2.0（当前架构） |
| :--- | :--- | :--- |
| 架构形态 | 中心化微服务网关平台，需常驻后台进程 | 去中心化工具链，支持独立编译与按需调度 |
| 生产底座 | Java 21、Spring Boot 3.3、JVM 虚拟机 | 默认 Node.js 24 LTS 生产底座，完全兼容 Bun |
| 契约形式 | Groovy 或 Python 脚本，依赖运行时数据库反射 | defineAction 声明配合 actiondock.manifest.json 静态清单 |
| 依赖裁剪 | 缺乏静态依赖分析，全量加载执行 | BuildPlanner 基于清单 uses 声明进行静态依赖闭包裁剪 |
| 交付产物 | 庞大 Jar 包，目标环境必须预装 JDK | 单文件零依赖独立二进制、源码 Skill、独立二进制 Skill、MCP |
| 测试体系 | 依赖重量级容器上下文与外部测试数据库 | 独立测试包 @actiondock/testing，原生支持 node:test 与 tsx |
| 进程治理 | 易发生流读取挂起与管道死锁 | 统一 ProcessAPI，彻底杜绝句柄泄漏与流阻塞 |
| 通信通道 | 业务结果与日志混杂在标准输出流中 | 标准输出专供结构化 JSON 信封，日志定向写入标准错误流 |
| 存储引擎 | 外部 MySQL、PostgreSQL 或内存 H2 | 内嵌轻量 SQLite 引擎，原生支持生存时间与命名空间 |

---

## 编程范式与测试演进对比

### 1.0 Groovy 动态脚本范式

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

export default defineAction({
  id: "network.ping-host",
  description: "检测指定主机的网络连通性",
  inputSchema: {
    type: "object",
    properties: { host: { type: "string" } },
    required: ["host"],
  },
  outputSchema: {
    type: "object",
    properties: {
      host: { type: "string" },
      reachable: { type: "boolean" },
    },
    required: ["host", "reachable"],
  },
  async run(input: { host: string }, ctx) {
    const cached = await ctx.state.get(`status:${input.host}`);
    if (cached !== undefined) {
      return { host: input.host, reachable: Boolean(cached) };
    }

    const res = await ctx.process.exec("ping", ["-c", "1", input.host], {
      signal: ctx.signal,
      timeoutMs: 3000,
    });

    const reachable = res.ok && res.exitCode === 0;
    ctx.log.info("连通性探测执行完成", { host: input.host, reachable });

    // 持久化存储并设置 300 秒生存时间
    await ctx.state.set(`status:${input.host}`, reachable, 300);

    return { host: input.host, reachable };
  },
});
```

### 2.0 单元测试范式：标准 node:test 与确定性沙箱

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import pingAction from "../actions/ping-host";

describe("network.ping-host 单元测试", () => {
  it("通过模拟命令进行毫秒级确定性验证", async () => {
    const runtime = createTestRuntime();

    // 预设命令响应，无需真实发起网络探测
    runtime.process.register("ping", {
      ok: true,
      exitCode: 0,
      stdout: "1 packets transmitted, 1 received",
    });

    const result = await runtime.run(pingAction, { host: "127.0.0.1" });
    assert.equal(result.reachable, true);

    // 验证状态已写入内存 SQLite
    const cached = await runtime.state.get("status:127.0.0.1");
    assert.equal(cached, true);
  });
});
```

---

## 迁移后验收命令速查

- **执行单元测试**：`npm test`（或 `node --import tsx --test tests/*.test.ts`）
- **校验 Action 契约**：`ad action validate <action-id>`
- **环境诊断体检**：`ad doctor`
- **本地运行验证**：`ad run <action-id> --input '<json>'`
- **协议暴露验证**：`ad mcp`
- **独立二进制构建**：`ad build --target <target>`
- **导出智能体技能**：`ad export skill`
