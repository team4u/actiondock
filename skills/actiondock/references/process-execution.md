# 参考手册：受管进程与系统命令执行指南

本参考手册面向 Action 工具开发者。它规范底层命令与子进程调用的治理原则。它阐述核心执行模式、逐流增量解码机制与测试规范。

---

## 进程治理设计定位与核心红线

在编写智能体工具时，调度底层操作系统命令是常见需求。直接使用 Node.js 原生的 `child_process`（如 `exec` 或 `spawn`）在生产环境中具有极高风险。这容易导致僵尸进程残留，或巨量输出耗尽宿主内存。它还可能导致并发写入交错损坏状态、多字节字符截断乱码以及退出管道悬挂。

ActionDock 通过运行时内核提供受管进程机制：
- 严禁裸进程调用：严禁在 Action 内部直接引入或调用 Node.js 原生 `node:child_process` 模块。所有系统命令必须通过 `ctx.process` 接口执行。
- 管道物理隔离：进程标准流通过内核驱动层完全隔离接管，避免污染标准输出。
- 防御性输出截断：内核提供环形输出日志与硬性容量上限，防止内存耗尽。
- 跨平台进程树清理：无论是正常停止还是错误中断，均整树递归清理。系统利用作业对象或进程组清理，杜绝孤儿进程残留。

---

## 受管进程两大执行模式

ActionDock 进程体系提供两种核心执行范式：

- 一次性执行 `run`：
  - 适用场景：短时有界命令（如 `git status`、`docker ps`、工具版本查询、快速文件校验）。
  - 执行特征：调用方等待命令执行完成。单次返回标准输出、标准错误与退出元数据。内置超时终止与缓冲区截断保护。超时、取消或输出超限触发的终止与收尾由同一调用等待。终止失败通过该调用报告，不产生脱离调用链的未处理拒绝。
- 长期交互进程 `start`：
  - 适用场景：交互式会话、长时间构建监听或多轮交互环境（如 Python REPL、Node.js 解释器交互、持续日志监听）。
  - 执行特征：启动后返回全局唯一进程标识符与初始游标。后续输入写操作直接提交。输出拉取基于不透明游标长轮询推进。

---

## 实战范例一：使用 run 执行短时有界命令

实现受管的 Git 状态检测动作。通过 `ctx.process.run` 配置执行时限与输出大小约束，并结合 `decodeText` 安全解码：

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

## 实战范例二：使用 start 管理长期交互进程

对于需要多轮输入与输出交互的场景，先通过 `ctx.process.start` 启动长期受管进程。随后直接提交写入指令并按游标读取输出：

```ts
import {
  defineAction,
  encodeText,
  createStreamDecoder,
} from "@actiondock/sdk";

export default defineAction(async (input: { command: string }, ctx) => {
  const startResult = await ctx.process.start({
    requestId: `start-${ctx.run.id}`,
    spec: { executable: "node", args: ["-i"], io: { mode: "pipe" } },
  });

  const decoder = createStreamDecoder();

  await ctx.process.write(startResult.process.id, {
    requestId: `write-${ctx.run.id}`,
    data: encodeText(`${input.command}\n`),
  });

  const readResult = await ctx.process.read(startResult.process.id, {
    cursor: startResult.initialCursor,
    maxBytes: 64 * 1024,
    waitMs: 2000,
    onGap: "skip",
  });

  return { output: decoder.decodeChunks(readResult.chunks) };
});
```

## 逐流增量解码与环形缓冲区游标推进

受管进程输出具有流式、分块传输与多流交错特性：

- 增量解码机制：`createStreamDecoder` 为每个流独立维护 UTF-8 解码状态机。当多字节字符跨数据块拆分时，自动保留未完结字节。后续数据块拼合后再行解码，避免乱码。
- 游标连续推进：每次拉取输出时，将上一轮返回的 `nextCursor` 作为下次调用的 `cursor` 传入。此机制实现连续递增读取。
- 缓冲区覆盖断层处理：若读取过慢导致新数据覆盖环形缓冲区末尾，`read` 将返回断层区间。配置 `onGap: "skip"` 将自动跳过已淘汰区间并推进至有效数据起点。配置 `onGap: "error"` 则主动抛出错误。
- 自然退出与排空期：子进程退出后，内核保留 5 秒输出排空倒计时。排空期内未消费的输出仍可继续拉取，直到流关闭标记置位。

---

## 资源配额与全生命周期清理

内核实施严格的资源限额审计，杜绝资源泄漏：

- 作用域与宿主配额：每个 Action 包作用域默认限制最多 8 个活跃受管进程。单个宿主环境默认限制最多 64 个活跃受管进程。超出限额时系统直接拒绝生成并抛出错误。
- 内存缓冲区配额：单进程输出环形缓冲区默认上限 4MB。宿主全部进程输出缓冲区累计上限 128MB。输入待写队列单进程上限 1MB，宿主累计上限 16MB。
- 空闲超时与寿命上限：通过 `idleMs`（无交互超时）与 `lifetimeMs`（硬性最长存活期）自动清理空闲与超时进程。
- 跨平台进程树清理：清理进程时，统一整树递归终止。在 Windows 下使用作业对象，在 POSIX 下使用负 PID 进程组，根除孤儿进程。

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

---

## 工程工具统一进程驱动与 Windows 包管理器支持边界

依赖冷首装、包管理器探测、事务恢复安装、依赖增删及产物打包统一通过 `executeCommand` 复用 `NodeProcessDriver`。由驱动负责进程启动和终止。包管理器启动解析只负责选择可执行文件与参数数组。

`ad test` 的终端继承模式共用包管理器解析器。它保留真实的标准输入、输出与终端继承。Action 业务继续使用 `ctx.process`。`executeCommand` 面向可信工程工具，不替代 Action 的受管调用、所有者与权限边界。

一次性工程命令须同时取得进程退出结果与真实输出关闭，才按退出码返回。主进程先退出且后代仍持有管道时继续等待。整体超时与取消在此期间仍有效。系统不会把 5 秒排空截止当作成功。驱动报告排空超时时，执行器报告失败并完成清理。

### 统一启动契约

- 统一无 shell 执行：所有工具调用保持非 shell 模式（`shell: false`）。此举消除命令拼接注入面与 Node.js `DEP0190` 告警。
- 参数边界保真：参数列表严格保持数组结构。路径中的空格、引号、`&`、`%` 与特殊字符原样透传至子进程，不执行二次转义。
- 环境变量隔离：SDK 默认环境变量白名单保持不变。可信工程工具显式继承宿主环境以保留包管理器配置。Action 业务仍遵循 `ctx.process` 继承策略。

### Windows 平台包管理器支持边界

- 严格依赖路径发现：严格依据执行环境中的 `PATH` 与 `PATHEXT` 检索目标包管理器。同名环境键仅大小写不同时，先按字典序去重，再选择路径。这确保解析器与子进程使用同一份有效环境。
- 原生程序直接调用：命中原生二进制文件（如 `npm.exe` 或 `bun.exe`）时，直接通过底层驱动启动。系统不借助外层解释器。
- 标准批处理转接：命中 `npm.cmd` 或 `npm.bat` 时，安装目录需具备标准 CLI 布局（可定位 `npm-cli.js`）。Node.js 运行时以无 Shell 模式加载执行。项目内垫片指向 `../npm/bin/npm-cli.js` 时同样受支持。
- 非标准包装显式失败：脚本若缺少标准入口或可用工具，执行链路显式报告失败并输出诊断信息。严禁静默回退至 shell 执行。严禁借用无关环境中的 `npm_execpath` 伪装成功。
