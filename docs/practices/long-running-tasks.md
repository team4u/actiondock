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

对于耗时极长的任务，ActionDock 支持通过远程微服务模式或 MCP Tasks 协议以异步方式调度：

- 异步启动长任务：
  ```bash
  ad run data.batch-process --async --input '{"items":["a","b","c","d"]}'
  ```
  命令立即返回运行标识（`runId`），而不会在终端中长时间等待。

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
