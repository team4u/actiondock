# 实战指南：受管进程与长期生命周期治理

构建智能体工具、运维集成与代码分析时，调度底层操作系统进程是核心能力。未受管控的进程调用伴随崩溃、内存溢出与并发竞争等风险。

ActionDock 提供受管进程架构。内核统一调度、逐流解码、有界环形日志与配额审计，保障进程全生命周期管控。

---

## 传统进程调用的核心痛点

- 僵尸孤儿失控：任务超时或主进程崩溃时，派生的子进程脱壳留存于后台，持续霸占系统资源。
- 内存溢出：外部命令产生巨量输出时，无界缓冲区会耗尽宿主内存并引发崩溃。
- 并发写入冲突：多个调用同时向同一长期交互进程写入指令，会导致数据错乱与状态损坏。
- 字符解码乱码：跨数据块传输或多流交错时，直接文本解码会导致截断乱码。
- 管道排空悬挂：子进程退出后其子派生进程依然持有标准输出句柄，导致输出读取陷入无限挂起。

---

## 受管进程核心模型与交互范式

受管进程体系由两种核心执行模式与配套控制工具构成：

- 一次性执行 `run`：适用于短时有界命令（如 `git status`、`docker ps` 等）。方法等待命令结束并收集输出，内置超时阻断与截断保护。同一调用等待终止与收尾，并报告终止失败，避免产生未处理拒绝。
- 长期受管进程 `start`：适用于持续交互、长时间构建或交互式会话（如终端解释器、REPL 环境、编译监听等）。启动后返回全局唯一进程标识与初始游标，后续通过独立接口读写与控制。
- 逐流增量解码 `createStreamDecoder`：针对不同流（`stdout`、`stderr`、`pty`）独立保留未完整接收的多字节序列，杜绝跨流交错与切块乱码。
- 有界环形日志与游标读取 `read`：进程输出汇聚于有界环形日志。接口支持游标分页与长轮询等待，自动识别缓冲区断层。

---

## 实战一：使用 run 执行短时有界命令

实现受管的 Git 状态检测动作 `git.status`。通过 `ctx.process.run` 配置执行时限与输出大小约束：

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
    throw new Error(`Git 命令执行错误，退出码: ${result.exit.code}`);
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

## 实战二：使用 start 管理长期交互进程

对于需要多次交互的场景，先调用 `ctx.process.start` 创建长期进程。随后直接写入指令并按游标读取输出：

```ts
import {
  defineAction,
  encodeText,
  createStreamDecoder,
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

  // 直接向执行中的受管进程写入命令数据
  await ctx.process.write(processId, {
    requestId: `write-${ctx.run.id}-1`,
    data: encodeText(`${input.command}\n`),
  });

  // 基于游标长轮询读取进程响应输出
  const readResult = await ctx.process.read(processId, {
    cursor: currentCursor,
    maxBytes: 64 * 1024,
    waitMs: 2000,
    onGap: "skip",
  });

  currentCursor = readResult.nextCursor;

  return {
    processId,
    response: decoder.decodeChunks(readResult.chunks),
  };
});
```

---

## 长期进程交互安全保证

- 写入前状态检查：仅允许向执行中的进程提交写入。进程隔离或进入终态后立即拒绝。
- 输入队列串行调度：同一进程的写入按队列串行派发，结算窗口以取消纪元防御并发接管竞态。
- 写入不确定失败隔离：底层写入出现不确定结果时，进程转入隔离状态并冻结输入队列。这杜绝了半损坏状态的静默扩散。
- 有界资源约束：空闲超时、寿命上限与缓冲区配额持续守护。超限进程按优雅终止流程回收。

---

## 逐流增量解码与输出游标推进

受管进程的输出流具有流式、分块与多流交错的特性：

- 增量解码机制：`createStreamDecoder`（别名 `createIncrementalTextDecoder`）为不同流维护独立解码状态机。当底层把多字节字符切分在两个连续 `OutputChunk` 时，解码器自动暂存残缺字节，拼合后再输出，避免乱码。
- 游标连续推进：每次调用 `read` 均返回 `nextCursor` 与当前状态。后续拉取将上一轮 `nextCursor` 传入 `cursor` 即可推进。
- 环形缓冲断层处理：消费者读取过慢导致缓冲区覆盖时，`read` 返回 `gap` 区间。配置 `onGap: "error"` 抛出错误，配置 `onGap: "skip"` 则跨过丢弃区间推进至最早保留位置。
- 自然退出与排空截止：进程主进程退出后，内核启动 5 秒输出排空倒计时。在排空期内未消费完的残余输出仍可继续读取，直到输出流标记为 `outputClosed` 并置位 `eof`。

---

## 资源配额与清理策略

为防止系统资源耗尽，内核实施严格的限额约束与审计清理：

- 作用域与宿主配额：包作用域限 8 个活跃进程，宿主限 64 个并发进程。超额将拒绝创建并抛出错误。
- 内存缓冲区配额：单进程输出缓冲区默认上限 4MB，宿主所有进程输出缓冲区累计上限 128MB。输入待写队列单进程上限 1MB，宿主累计上限 16MB。
- 空闲超时与寿命上限：可为受管进程指定 `idleMs`（空闲超时）与 `lifetimeMs`（最大存活时间），超时后内核自动回收。
- 进程树清理：驱动层通过进程组（POSIX 负 PID 或 Windows 作业对象）整树递归终结。这杜绝了孤儿进程残留。

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

---

## 工程工具统一进程驱动与 Windows 包管理器支持边界

依赖安装、探测与打包统一通过 `executeCommand` 复用 `NodeProcessDriver`。驱动负责进程启动和终止。解析器只负责选择文件与参数。

`ad test` 终端继承模式共用解析器，保留标准输入、输出与终端继承。Action 业务继续使用 `ctx.process`。`executeCommand` 面向可信工具，不替代受管调用的权限边界。

一次性命令须同时取得进程退出结果与输出关闭，才按退出码返回。主进程退出且后代持有管道时继续等待。超时与取消仍有效。驱动报告排空超时时，执行器报告失败并清理。

### 统一启动契约

- 统一无 shell 执行：所有工具调用严格保持非 shell 模式（`shell: false`），从源头消除命令拼接注入面与 Node.js `DEP0190` 告警。
- 参数边界保真：参数列表严格保持数组结构。路径中的空格、引号、`&`、`%` 等特殊字符原样透传至子进程，不二次转义。
- 环境变量隔离：SDK 默认环境变量白名单保持不变。可信工具显式继承宿主环境以保留包管理器配置。Action 业务仍遵循 `ctx.process` 策略。

### Windows 平台包管理器支持边界

- 严格依赖路径发现：依据执行环境中的 `PATH` 与 `PATHEXT` 环境变量检索目标包管理器。同名环境键按 Node.js 规则以字典序去重，确保使用同一份环境。
- 原生程序直接调用：若命中原生二进制文件（如 `npm.exe` 或 `bun.exe`），直接通过底层驱动启动，不借助外层解释器。
- 标准批处理转接：命中 `npm.cmd` 或 `npm.bat` 且具备标准布局时，Node.js 运行时以无 Shell 模式加载执行。项目内垫片标准布局同样受支持。
- 非标准包装显式失败：脚本缺少标准 CLI 入口或不存在工具时，执行链路显式报告错误。系统严禁静默回退至 shell 执行，严禁借用无关环境中的 `npm_execpath`。
