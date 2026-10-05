# 实战指南：长时间异步任务与进度上报

在执行大规模数据同步、多文件扫描、批处理分析或模型微调等长时间运行任务时，简单的单次阻塞调用会导致客户端连接超时，且无法获取任务当前的执行阶段。

本指南指导开发者如何使用 `ctx.progress`、`ctx.state` 以及结合 MCP Tasks 规范，实现具备进度可观测、断点标记与协作式取消的长时间异步任务。

---

## 异步长任务的核心挑战

- 传输层连接超时：标准的 HTTP 请求或客户端交互通常具备 30 秒至 60 秒的超时阈值。未设计异步模式的任务极易被网络中间件强行切断。
- 过程黑盒无反馈：调用方无法获知任务执行到哪一步、处理了多少百分比，无法做出人机交互反馈。
- 取消响应迟缓：当调用端主动中断任务时，服务端若未监听取消信号，仍将无谓耗尽计算资源。

---

## 编写具备进度反馈的长任务 Action

以批量处理数据资产动作 `data.batch-process` 为例：

```ts
import { defineAction } from "@actiondock/sdk";

export interface BatchProcessInput {
  items: string[];
}

export interface BatchProcessOutput {
  processedCount: number;
  completedAt: string;
}

export default defineAction(async (input: BatchProcessInput, ctx): Promise<BatchProcessOutput> => {
  const total = input.items.length;
  ctx.log.info(`开始批量处理任务，总计 ${total} 项数据`);

  // 初始化进度上报
  ctx.progress.report(0, total, "任务已初始化，准备开始批处理");

  let successCount = 0;

  for (let i = 0; i < total; i++) {
    // 检查协作式取消信号
    if (ctx.signal.aborted) {
      ctx.log.warn(`任务在第 ${i} 项被调用端主动中止`);
      throw new Error("任务已被调用端取消");
    }

    const item = input.items[i];
    ctx.log.info(`正在处理第 [${i + 1}/${total}] 项: ${item}`);

    // 模拟耗时业务计算
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 使用 ctx.state 记录处理断点，防止故障后状态丢失
    await ctx.state.set("last_processed_index", i);

    successCount++;

    // 实时上报当前进度
    ctx.progress.report(
      successCount,
      total,
      `正在处理第 ${successCount} 项，完成度 ${Math.round((successCount / total) * 100)}%`
    );
  }

  ctx.progress.report(total, total, "所有项处理完成");

  return {
    processedCount: successCount,
    completedAt: new Date().toISOString(),
  };
});
```

---

## 异步调度与状态管理

对于耗时极长的任务，ActionDock 支持通过远程微服务模式、MCP Tasks 协议或本地标准后台方式进行调度：

- 远程异步启动长任务：
  ```bash
  # 远程服务模式下使用 --async 异步派工（需指定 --profile 或 --server）：
  ad run data.batch-process --profile prod --async -- items.0=a items.1=b items.2=c items.3=d
  # 复杂或批量数据可通过文件传递（与扁平参数互斥）：
  # ad run data.batch-process --profile prod --async --input-file ./batch.json
  ```
  命令立即返回运行标识（`runId`），而不会在终端中长时间等待。`--async` 选项专用于远程服务或环境配置模式，独立的本地命令行执行不支持该选项。

- 本地后台启动长任务：
  ```bash
  # 本地进程模式下，通过标准后台方式启动（& 或 nohup）：
  ad run data.batch-process --input-file ./batch-1.json &
  # 或使用 nohup 脱机后台运行并预置幂等请求标识：
  nohup ad run data.batch-process --request-id batch-main --input-file ./batch.json >/dev/null 2>&1 &
  ```

- 查询任务当前状态与进度：
  ```bash
  ad runs show <runId>
  ```
  返回包含当前状态（`running`、`success` 等）及进度历史的详细信息。

- 取消正在运行的任务：
  ```bash
  ad runs cancel <runId> --reason "用户主动终止"
  ```
  执行服务会向对应运行实例发射 `ctx.signal`，业务函数感知后退出。

- 阻塞等待多个运行终态聚合退出：
  ```bash
  # 本地并行派工后统一收结果（通过标准后台方式 & 启动本地独立进程）
  ad run data.batch-process --input-file ./batch-1.json &
  ad run data.batch-process --input-file ./batch-2.json &
  ad runs watch <runId1> <runId2> --json

  # 后台派工拿不到 runId 时，派工携带 --request-id，再以同标识等待
  nohup ad run data.batch-process --request-id batch-main --input-file ./batch.json >/dev/null 2>&1 &
  ad runs watch --request-id batch-main --timeout 30m --json
  ```
  watch 只读旁观，不取消不收割；超时或中断信号仅退出等待并输出当前状态，不会终止任务；退出码仅在全部终态且全部执行成功时为 0。

- 幂等请求标识的作用域说明：
  - 在统一服务实例与远程常驻服务模式（如 `ad serve` 或远程服务）下，支持相同入参请求的幂等去重重放。若传入相同的 `--request-id` 与相同入参，服务端会拦截重复调度并直接返回先前的执行结果。
  - 在独立的本地命令行进程模式下，`--request-id` 主要作为关联标识与状态反查凭据（供 `ad runs list` 过滤与 `ad runs watch` 精准对因反查）。由于不同独立本地命令行进程分属独立的进程实例，各进程直接执行并落库，不会跨进程自动拦截重放。

---

## 编写进度测试用例

使用 `@actiondock/testing` 验证进度上报事件：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import batchProcessAction from "../actions/batch-process.js";

describe("长任务进度上报测试", () => {
  it("应当按顺序上报进度并在结束时成功完成", async () => {
    const runtime = createTestRuntime();

    const output = await runtime.run(batchProcessAction, {
      items: ["item1", "item2"],
    });

    assert.equal(output.processedCount, 2);

    // 审查事件总线中记录的进度事件
    const progressEvents = runtime.events
      .getEvents()
      .filter((e) => e.type === "progress");

    assert.ok(progressEvents.length >= 2);
    const lastProgress = progressEvents[progressEvents.length - 1];
    assert.equal(lastProgress.payload.current, 2);
    assert.equal(lastProgress.payload.total, 2);
  });
});
```
