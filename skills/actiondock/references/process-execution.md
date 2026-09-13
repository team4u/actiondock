# 参考手册：受管进程与系统命令执行指南

本参考手册面向 Action 工具开发者，规范底层操作系统命令与子进程调用的治理原则、核心执行模式、独占控制权租约契约、逐流增量解码机制与确定性单元测试规范。

---

## 进程治理设计定位与核心红线

在编写智能体工具时，调度底层操作系统命令是常见需求。直接使用 Node.js 原生的 `child_process`（如 `exec`、`spawn` 等）在生产环境中具有极高风险，极易导致孤儿僵尸进程残留、巨量输出耗尽宿主内存、并发写入交错损坏状态、多字节字符截断乱码以及退出管道悬挂。

ActionDock 通过运行时内核提供工业级受管进程机制：
- 严禁裸进程调用：严禁在 Action 内部直接引入或调用 Node.js 原生 `node:child_process` 模块，所有系统命令必须通过 `ctx.process` 接口执行。
- 管道物理隔离：进程标准流通过内核驱动层完全隔离接管，避免污染标准输出。
- 防御性输出截断：内核提供环形输出日志与硬性容量上限，防止内存耗尽。
- 跨平台进程树清理：无论是正常停止还是异常中断，均通过操作系统作业或进程组整树递归清理，杜绝孤儿进程残留。

---

## 受管进程两大执行模式

ActionDock 进程体系提供两种核心执行范式：

- 一次性执行 `run`：
  - 适用场景：短时有界命令（如 `git status`、`docker ps`、工具版本查询、快速文件检查）。
  - 执行特征：调用方等待命令执行完成，单次返回标准输出、标准错误与退出元数据，内置超时终止与缓冲区截断保护。
- 长期交互进程 `start`：
  - 适用场景：交互式会话、长时间构建监听或多轮交互环境（如 Python REPL、Node.js 解释器交互、持续日志监听）。
  - 执行特征：启动后返回全局唯一进程标识符与初始游标。后续所有输入写操作必须在独占控制权租约 `withControl` 下执行，输出拉取基于不透明游标长轮询推进。

---

## 实战范例一：使用 run 执行短时有界命令

实现受管的 Git 状态检测动作，通过 `ctx.process.run` 设定执行时限与输出大小约束，并结合 `decodeText` 安全解码：

```typescript
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
  ctx.log.info(`开始检测目录状态: ${input.workingDirectory}`);

  // 使用 run 一次性执行外部系统命令
  const result = await ctx.process.run(
    {
      spec: {
        executable: "git",
        args: ["status", "--porcelain", "-b"],
        cwd: input.workingDirectory,
        io: { mode: "pipe" },
      },
      // 超时控制：超过 10 秒强制终止并清理进程树
      timeoutMs: 10000,
      // 缓冲区保护：最多收集 1MB 输出，超出部分安全截断
      maxOutputBytes: 1024 * 1024,
    },
    { signal: ctx.signal }
  );

  // 校验子进程退出码
  if (result.exit.code !== 0) {
    throw new Error(`Git 命令执行异常，退出码: ${result.exit.code}`);
  }

  // 使用 decodeText 统一解码合并收集到的输出数据块
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

## 实战范例二：使用 start 与 withControl 管理长期交互进程

对于需要多轮输入与输出交互的场景，先通过 `ctx.process.start` 启动长期受管进程，随后在 `withControl` 保护下安全提交指令并读取输出：

```typescript
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

  // 在独占控制权租约保护下安全执行交互写与读
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
      // 写入命令数据，必须附带当前有效的独占控制令牌
      await ctx.process.write({
        token: grant.token,
        requestId: `write-${ctx.run.id}-1`,
        data: encodeText(`${input.command}\n`),
      });

      // 基于游标长轮询拉取进程响应输出
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

针对长期交互进程，为防止多个调用者并发向同一进程写入指令导致数据交织错乱，SDK 提供了高层辅助函数 `withControl`：

- 自动申请与排队：调用 `acquire` 申请独占控制令牌，支持指定排队等待超时。
- 定期自动续租：租约存活期间，在后台按三分之一 TTL 周期自动调用 `renew` 维持有效状态。
- 正常执行显式释放：业务函数顺利执行完成后，显式调用 `release` 归还令牌，允许后续等待者获取控制权。
- 异常中断强制终止与隔离：若业务闭包抛出异常、外部取消信号触发或后台续租失败，严禁调用 `release` 释放处于不确定状态的进程，而是严格按契约调用 `stop` 终止并隔离进程，同时将原始异常向外抛出。
- 临时性错误容错保护：若业务执行成功但释放令牌时因临时性繁忙失败，仅记录警告并保留业务成功结果，避免误杀正常进程。

---

## 逐流增量解码与环形缓冲区游标推进

受管进程输出具有流式、分块传输与多流交错特性：

- 增量解码机制：`createStreamDecoder`（或 `createIncrementalTextDecoder`）为每个流独立维护 UTF-8 解码状态机。当多字节字符跨数据块拆分时，自动保留未完结字节，后续数据块拼合后再行解码，彻底避免乱码。
- 游标连续推进：每次拉取输出时，将上一轮返回的 `nextCursor` 作为下次调用的 `cursor` 传入，实现无缝递增读取。
- 缓冲区覆盖断层处理：若读取过慢导致环形缓冲区末尾被新数据覆盖，`read` 将返回断层区间。配置 `onGap: "skip"` 将自动跳过已淘汰区间推进至当前有效数据起点；配置 `onGap: "error"` 则主动抛出错误。
- 自然退出与排空期：子进程退出后，内核保留 5 秒输出排空倒计时。排空期内未消费的输出仍可继续拉取，直到流关闭标记置位。

---

## 资源配额与全生命周期清理

内核实施严格的资源限额审计，杜绝资源泄漏：

- 作用域与宿主配额：每个 Action 包作用域默认限制最多 8 个活跃受管进程；单个宿主环境默认限制最多 64 个活跃受管进程。超出限额将直接拒绝创建并抛出错误。
- 内存缓冲区配额：单进程输出环形缓冲区默认上限 4MB，宿主全部进程输出缓冲区累计上限 128MB；输入待写队列单进程上限 1MB，宿主累计上限 16MB。
- 空闲超时与寿命上限：通过 `idleMs`（无输入输出交互超时）与 `lifetimeMs`（硬性最长存活期）自动淘汰清理空闲与超时进程。
- 跨平台进程树清理：停止或清理进程时，统一通过操作系统作业对象（Windows）或负 PID 进程组（POSIX）执行整树递归终止，根除孤儿进程。

---

## 编写确定性受管进程单元测试

在编写 Action 单元测试时，严禁唤起操作系统真实子进程。借助 `@actiondock/testing` 提供的 `FakeProcessDriver` 与 `createTestRuntime`，可实现确定性事件模拟与断言验证：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime, FakeProcessDriver } from "@actiondock/testing";
import gitStatusAction from "../actions/git-status.js";

describe("受管进程执行测试", () => {
  it("使用 FakeProcessDriver 验证短时命令正常执行", async () => {
    const fakeDriver = new FakeProcessDriver();

    // 拦截派生并模拟进程生命周期事件
    fakeDriver.onSpawn = (handle) => {
      // 确定性发射模拟输出
      handle.emitOutput("stdout", "## main...origin/main\n M package.json\n");
      // 发射退出事件与输出流关闭事件
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

    // 断言系统命令派生参数
    assert.equal(fakeDriver.spawnCalls.length, 1);
    assert.equal(fakeDriver.spawnCalls[0].spec.executable, "git");
    assert.deepEqual(fakeDriver.spawnCalls[0].spec.args, ["status", "--porcelain", "-b"]);
  });

  it("验证外部命令异常退出时的错误拦截", async () => {
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
