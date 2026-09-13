# 实战指南：受管进程与长期生命周期治理

在构建智能体工具、运维集成以及代码分析等场景时，调度底层操作系统进程是核心能力之一。然而，未受管控的进程调用往往伴随着系统崩溃、内存溢出、僵尸孤儿空转与并发写竞争等重大风险。

ActionDock 提供了工业级受管进程架构，通过内核统一调度、独占控制权租约、逐流增量解码、有界环形输出日志与资源配额审计，保障进程生命周期的可靠管控。

---

## 传统进程调用的核心痛点

- 僵尸孤儿失控：任务超时或主进程异常崩溃时，派生的子进程脱壳留存于后台，持续霸占系统资源。
- 内存瞬间爆仓：外部命令若产生巨量输出（如无限循环日志或全量文件导出），无界缓冲区会迅速耗尽宿主内存并引发崩溃。
- 并发写入冲突：多个智能体调用同时向同一长期交互进程的输入流写入指令，导致数据交织错乱、程序状态彻底毁坏。
- 字符解码乱码：多字节字符跨数据块传输，或标准输出与标准错误交错合并时，简单粗暴的直接文本解码会导致截断乱码与数据失真。
- 管道排空悬挂：子进程退出后其子派生进程依然持有标准输出句柄，导致输出读取陷入无限挂起。

---

## 受管进程核心模型与交互范式

受管进程体系由两种核心执行模式与配套控制工具构成：

- 一次性执行 `run`：适用于短时有界命令（如 `git status`、`docker ps`、工具版本查询等）。该方法等待命令结束并收集有限输出，内置超时阻断与输出截断保护。
- 长期受管进程 `start`：适用于持续交互、长时间构建或交互式会话（如终端解释器、REPL 环境、编译监听等）。启动后返回全局唯一进程标识与初始游标，后续通过独立接口读写与控制。
- 独占控制权机制 `withControl`：对长期进程发起写操作必须持有有效控制令牌。同一时间仅允许单一调用者持有控制权；`withControl` 自动完成租约申请、后台定期续租、正常完成释放，并在发生异常或中断时执行终止隔离。
- 逐流增量解码 `createStreamDecoder`：针对不同流（`stdout`、`stderr`、`pty`）独立保留未完整接收的多字节序列，杜绝跨流交错与切块乱码。
- 有界环形日志与游标读取 `read`：所有进程输出汇聚于内核有界环形日志，支持基于游标的分页拉取与长轮询等待，自动识别缓冲区覆盖断层。

---

## 实战一：使用 run 执行短时有界命令

实现一个受管的 Git 状态检测动作 `git.status`。通过 `ctx.process.run` 设定明确的执行时限与输出大小约束：

```ts
import { defineAction, decodeText } from "@actiondock/sdk";

export interface GitStatusInput {
  workingDirectory: string;
}

export interface GitStatusOutput {
  branch: string;
  isClean: boolean;
  rawOutput: string;
  truncated: boolean;
}

export default defineAction(async (input: GitStatusInput, ctx): Promise<GitStatusOutput> => {
  ctx.log.info(`开始检测目录 ${input.workingDirectory} 的 Git 状态`);

  // 借助 run 方法一次性执行外部命令
  const result = await ctx.process.run(
    {
      spec: {
        executable: "git",
        args: ["status", "--porcelain", "-b"],
        cwd: input.workingDirectory,
        io: { mode: "pipe" },
      },
      // 超时控制：超过 10 秒强制终止
      timeoutMs: 10000,
      // 缓冲区保护：最多收集 1MB 输出，超出部分安全截断
      maxOutputBytes: 1024 * 1024,
    },
    { signal: ctx.signal }
  );

  // 检查进程退出码
  if (result.exit.code !== 0) {
    throw new Error(`Git 命令执行异常，退出码: ${result.exit.code}`);
  }

  // 使用 SDK 提供的 decodeText 统一解码收集到的输出块
  const fullText = decodeText(result.chunks);
  const lines = fullText.trim().split("\n");
  const branchLine = lines[0] || "";
  const isClean = lines.length <= 1 || (lines.length === 2 && lines[1]?.trim() === "");

  return {
    branch: branchLine.replace("## ", ""),
    isClean,
    rawOutput: fullText,
    truncated: result.truncated,
  };
});
```

---

## 实战二：使用 start 与 withControl 管理长期交互进程

对于需要多次输入交互的场景（如交互式解释器），必须先通过 `ctx.process.start` 创建长期受管进程，并在 `withControl` 保护下安全提交指令与读取输出：

```ts
import {
  defineAction,
  encodeText,
  createStreamDecoder,
  withControl,
} from "@actiondock/sdk";

export interface ReplSessionInput {
  command: string;
}

export interface ReplSessionOutput {
  processId: string;
  response: string;
}

export default defineAction(async (input: ReplSessionInput, ctx): Promise<ReplSessionOutput> => {
  // 启动长期受管进程
  const startResult = await ctx.process.start(
    {
      requestId: `start-${ctx.run.id}`,
      spec: {
        executable: "node",
        args: ["-i"],
        io: { mode: "pipe" },
      },
      limits: {
        idleMs: 60000,
        lifetimeMs: 300000,
        outputBufferBytes: 2 * 1024 * 1024,
      },
    },
    { signal: ctx.signal }
  );

  const processId = startResult.process.id;
  let currentCursor = startResult.initialCursor;
  const decoder = createStreamDecoder();

  // 在独占控制权保护下执行业务写入与读取
  const responseText = await withControl(
    ctx.process,
    processId,
    {
      requestId: `eval-${ctx.run.id}`,
      ttlMs: 30000,
      waitMs: 5000,
      signal: ctx.signal,
    },
    async (grant) => {
      // 写入命令数据，必须携带当前有效的控制令牌
      await ctx.process.write({
        token: grant.token,
        requestId: `write-${ctx.run.id}-1`,
        data: encodeText(`${input.command}\n`),
      });

      // 基于游标长轮询读取进程响应输出
      const readResult = await ctx.process.read({
        cursor: currentCursor,
        maxBytes: 64 * 1024,
        waitMs: 2000,
        onGap: "skip",
      });

      currentCursor = readResult.nextCursor;
      return decoder.decodeChunks(readResult.chunks);
    }
  );

  return {
    processId,
    response: responseText,
  };
});
```

---

## 独占控制权与 withControl 保证契约

`withControl` 高层辅助函数封装了严密的控制权生命周期契约：

- 自动申请与排队：调用 `acquire` 申请独占控制令牌，支持设置排队等待超时。
- 定期自动续租：若未显式关闭，在租约存活期内按三分之一 TTL 周期自动调用 `renew` 延长租约。
- 正常成功显式释放：业务函数顺利执行完毕后，显式调用 `release` 释放令牌，允许后续排队者获取控制权。
- 异常中断强制终止：若业务执行出错、外部取消信号触发或后台续租失败，严禁调用 `release` 释放半损坏状态的进程，而是严格按契约调用 `stop` 终止或隔离进程，并将原始异常向外抛出。
- 临时错误容错保护：若业务成功执行但因临时性繁忙导致释放失败，记录警告并保留业务返回结果，避免对稳定进程进行不必要的误杀。

---

## 逐流增量解码与输出游标推进

受管进程的输出流具有流式、分块与多流交错的特性：

- 增量解码机制：`createStreamDecoder`（别名 `createIncrementalTextDecoder`）为不同输出流维护独立的解码状态机。当一个多字节 UTF-8 字符（如中文或特殊符号）被底层拆分在两个连续的 `OutputChunk` 中时，解码器自动暂存残缺字节，直到后续字节到达后完成拼合，彻底避免乱码。
- 游标连续推进：每次调用 `read` 均返回 `nextCursor` 与当前状态。后续拉取只需将上一轮的 `nextCursor` 传入 `cursor` 即可无缝推进。
- 环形缓冲断层处理：若消费者读取过慢导致环形缓冲区末尾被覆盖，`read` 将返回 `gap` 区间。此时若配置 `onGap: "error"` 将抛出异常，配置 `onGap: "skip"` 则自动跨过已丢弃区间推进至当前保留的最早位置。
- 自然退出与排空截止：当进程主进程退出后，内核启动 5 秒输出排空倒计时。在排空期内未消费完的残余输出仍可继续读取，直到输出流标记为 `outputClosed` 并置位 `eof`。

---

## 资源配额与清理策略

为防止系统资源耗尽，内核实施严格的限额约束与审计清理：

- 作用域与宿主配额：每个包作用域限制最大活跃受管进程数（默认 8），单宿主限制最大并发活跃进程数（默认 64）。超过配额将拒绝创建并抛出错误。
- 内存缓冲区配额：单进程输出缓冲区默认上限 4MB，宿主所有进程输出缓冲区累计上限 128MB；输入待写队列单进程上限 1MB，宿主累计上限 16MB。
- 空闲超时与寿命上限：可为受管进程指定 `idleMs`（无输入输出交互的空闲超时）与 `lifetimeMs`（硬性最大存活时间），超时后内核自动回收。
- 跨平台进程树清理：无论是正常 `stop` 还是异常清理，驱动层均通过操作系统进程组（POSIX 负 PID 或 Windows 进程作业）执行整树递归终结，根绝孤儿进程残留。

---

## 编写确定性受管进程测试

在单元测试中，严禁唤起操作系统真实进程。借助 `@actiondock/testing` 提供的 `FakeProcessDriver` 与 `createTestRuntime`，可实现确定性模拟与断言验证：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime, FakeProcessDriver } from "@actiondock/testing";
import gitStatusAction from "../actions/git-status.js";

describe("受管进程执行测试", () => {
  it("使用 FakeProcessDriver 验证短时命令执行", async () => {
    const fakeDriver = new FakeProcessDriver();

    // 配置派生拦截响应逻辑
    fakeDriver.onSpawn = (handle) => {
      // 确定性发射模拟标准输出
      handle.emitOutput("stdout", "## main...origin/main\n M package.json\n");
      // 确定性发射退出事件与输出通道关闭事件
      handle.emitExit({ code: 0, signal: null });
      handle.emitOutputClosed("natural");
    };

    const runtime = createTestRuntime({
      platform: {
        processDriver: fakeDriver,
      } as any,
    });

    const result = await runtime.run(gitStatusAction, {
      workingDirectory: "/workspace",
    });

    assert.equal(result.branch, "main...origin/main");
    assert.equal(result.isClean, false);

    // 断言驱动调用历史
    assert.equal(fakeDriver.spawnCalls.length, 1);
    assert.equal(fakeDriver.spawnCalls[0].spec.executable, "git");
    assert.deepEqual(fakeDriver.spawnCalls[0].spec.args, ["status", "--porcelain", "-b"]);
  });

  it("验证进程异常退出时的错误处理", async () => {
    const fakeDriver = new FakeProcessDriver();

    fakeDriver.onSpawn = (handle) => {
      handle.emitOutput("stderr", "fatal: not a git repository");
      handle.emitExit({ code: 128, signal: null });
      handle.emitOutputClosed("natural");
    };

    const runtime = createTestRuntime({
      platform: {
        processDriver: fakeDriver,
      } as any,
    });

    await assert.rejects(
      async () => {
        await runtime.run(gitStatusAction, {
          workingDirectory: "/invalid-dir",
        });
      },
      {
        message: /Git 命令执行异常，退出码: 128/,
      }
    );
  });
});
```
