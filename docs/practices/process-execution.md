# 实战指南：受控系统命令与子进程执行

在构建运维管理、代码分析、构建集成等领域的智能体工具时，调度底层操作系统命令（如 `git`、`docker`、`ffmpeg` 等）是不可或缺的手段。然而，未经治理的子进程执行往往是系统崩溃、内存耗尽与安全穿透的主要源头。

本指南介绍如何利用 `ctx.process` 统一受管进程接口，实现防注入、防爆仓、跨平台进程树清理与协作式取消的工业级命令执行。

---

## 传统脚本调用的四大安全死穴

- 注入攻击漏洞：使用带有 Shell 字符串拼接的执行方式，若入参包含特殊符号（如分号或管道符），攻击者可任意执行非预期系统指令。
- 僵尸孤儿空转：当宿主发生异常退出或任务超时时，派生的子进程并未被杀死，脱壳在后台持续消耗系统资源。
- 内存瞬间爆仓：执行某些产生巨量输出的命令（如对大仓库执行全量日志导出或无限循环输出），未设上限的输出缓冲区会撑爆 Node.js 内存堆并导致进程直接崩溃。
- 通道污染信封：子进程的标准输出直接倾泻到控制台，破坏上层 MCP 协议报文或 JSON 信封结构。

ActionDock 解决方案：底层默认禁用 Shell 解析、强制物理管道隔离、设置输出上限阈值防护，并在生命周期终止时统一执行跨平台进程组回收。

---

## 编写受控命令 Action

实现一个受管的 Git 状态检测动作 `git.status`：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GitStatusInput {
  workingDirectory: string;
}

export interface GitStatusOutput {
  branch: string;
  isClean: boolean;
  rawOutput: string;
}

export default defineAction(async (input: GitStatusInput, ctx): Promise<GitStatusOutput> => {
  ctx.log.info(`开始检测目录 ${input.workingDirectory} 的 Git 状态`);

  try {
    // 强制要求数组传参，杜绝 Shell 注入隐患
    const result = await ctx.process.exec("git", ["status", "--porcelain", "-b"], {
      cwd: input.workingDirectory,
      // 传递取消信号，当调用方取消或任务超时时，自动跨平台杀死子进程树
      signal: ctx.signal,
      // 超时控制：超过 10 秒强制终止
      timeoutMs: 10000,
      // 防爆保护：最大允许捕获 1MB 输出，超限立即杀死进程并抛出 PROCESS_OUTPUT_LIMIT
      maxOutputBytes: 1024 * 1024,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Git 命令执行异常 [退出码 ${result.exitCode}]: ${result.stderr}`);
    }

    const lines = result.stdout.trim().split("\n");
    const branchLine = lines[0] || "";
    const isClean = lines.length <= 1 || (lines.length === 2 && lines[1]?.trim() === "");

    return {
      branch: branchLine.replace("## ", ""),
      isClean,
      rawOutput: result.stdout,
    };
  } catch (err) {
    ctx.log.error(`Git 状态获取失败: ${(err as Error).message}`);
    throw err;
  }
});
```

---

## 编写纯内存进程模拟测试

在单元测试中，严禁依赖开发环境的真实外部命令。使用 `@actiondock/testing` 提供的 `MockProcessExecutor` 拦截进程派生：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime, MockProcessExecutor } from "@actiondock/testing";
import gitStatusAction from "../actions/git-status.js";

describe("系统命令受控执行测试", () => {
  it("应当正确解析模拟的 Git 输出", async () => {
    const mockProcess = new MockProcessExecutor();

    // 注册匹配规则：当命令为 git 且参数包含 status 时返回预置输出
    mockProcess.registerRule({
      match: (cmd, args) => cmd === "git" && args.includes("status"),
      output: {
        stdout: "## main...origin/main\n M package.json\n",
        stderr: "",
        exitCode: 0,
      },
    });

    const runtime = createTestRuntime({
      processExecutor: mockProcess,
    });

    const res = await runtime.run(gitStatusAction, { workingDirectory: "/workspace" });

    assert.equal(res.branch, "main...origin/main");
    assert.equal(res.isClean, false);

    // 断言命令调用历史
    const history = mockProcess.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].command, "git");
    assert.deepEqual(history[0].args, ["status", "--porcelain", "-b"]);
  });

  it("当命令返回非零退出码时应当抛出异常", async () => {
    const mockProcess = new MockProcessExecutor();

    mockProcess.registerRule({
      match: (cmd) => cmd === "git",
      output: {
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      },
    });

    const runtime = createTestRuntime({
      processExecutor: mockProcess,
    });

    await assert.rejects(
      async () => {
        await runtime.run(gitStatusAction, { workingDirectory: "/invalid-dir" });
      },
      {
        message: /Git 命令执行异常 \[退出码 128\]/,
      }
    );
  });
});
```
