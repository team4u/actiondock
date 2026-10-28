import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Capabilities, LaunchSpec } from "@actiondock/sdk";
import { executeCommand } from "../src/process/command-executor.ts";
import { NodeProcessDriver } from "../src/process/process-driver.ts";
import { DEFAULT_ENV_ALLOWLIST, type ProcessDriver, type ProcessHandle, type ProcessObserver } from "../src/process/driver.ts";
import {
  INVALID_ARGUMENT,
  PROCESS_CANCELLED,
  PROCESS_SPAWN_ERROR,
  PROCESS_TIMEOUT,
  ProcessError,
} from "../src/errors.ts";

/**
 * 确定性测试驱动辅助类，用于严格验证驱动生命周期契约。
 */
class BarrierTestDriver implements ProcessDriver {
  public onSpawn?: (spec: LaunchSpec, observer: ProcessObserver) => Promise<ProcessHandle> | ProcessHandle;
  public onTerminate?: (handle: ProcessHandle, graceMs: number) => Promise<void> | void;
  public onInputEOF?: (handle: ProcessHandle) => Promise<void>;
  public onDispose?: (handle: ProcessHandle) => Promise<void>;

  getCapabilities(): Capabilities {
    return {
      pty: false,
      resize: false,
      inputEOF: true,
      interruptForeground: true,
      terminationScope: "process-tree",
    };
  }

  async spawn(spec: LaunchSpec, observer: ProcessObserver): Promise<ProcessHandle> {
    if (this.onSpawn) {
      return this.onSpawn(spec, observer);
    }
    return { id: `barrier-handle-${Math.random().toString(36).slice(2)}`, pid: 66100 };
  }

  async inputEOF(handle: ProcessHandle): Promise<void> {
    if (this.onInputEOF) {
      return this.onInputEOF(handle);
    }
  }

  async terminate(handle: ProcessHandle, graceMs: number): Promise<void> {
    if (this.onTerminate) {
      await this.onTerminate(handle, graceMs);
    }
  }

  async dispose(handle: ProcessHandle): Promise<void> {
    if (this.onDispose) {
      await this.onDispose(handle);
    }
  }
}

describe("executeCommand 工程命令执行器测试", () => {
  it("正常执行命令并正确返回 status、stdout 与 stderr", async () => {
    const result = await executeCommand(process.execPath, [
      "-e",
      "process.stdout.write('hello-out'); process.stderr.write('hello-err'); process.exit(0);",
    ]);

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.signal, null);
    assert.strictEqual(result.stdout, "hello-out");
    assert.strictEqual(result.stderr, "hello-err");
    assert.strictEqual(result.truncated, false);
  });

  it("子进程非零退出状态码原样透传供调用方解释且不抛错", async () => {
    const result = await executeCommand(process.execPath, [
      "-e",
      "process.stderr.write('failed-with-42'); process.exit(42);",
    ]);

    assert.strictEqual(result.status, 42);
    assert.strictEqual(result.signal, null);
    assert.strictEqual(result.stderr, "failed-with-42");
    assert.strictEqual(result.truncated, false);
  });

  it("校验 maxOutputBytes 与 timeoutMs 非法参数在启动前拒绝", async () => {
    // maxOutputBytes 为负数、NaN 或 Infinity
    await assert.rejects(
      executeCommand("dummy", [], { maxOutputBytes: -1 }),
      (err: any) => err instanceof ProcessError && err.code === INVALID_ARGUMENT
    );
    await assert.rejects(
      executeCommand("dummy", [], { maxOutputBytes: NaN }),
      (err: any) => err instanceof ProcessError && err.code === INVALID_ARGUMENT
    );
    await assert.rejects(
      executeCommand("dummy", [], { maxOutputBytes: Infinity }),
      (err: any) => err instanceof ProcessError && err.code === INVALID_ARGUMENT
    );

    // timeoutMs 为负数、NaN 或 Infinity
    await assert.rejects(
      executeCommand("dummy", [], { timeoutMs: -1 }),
      (err: any) => err instanceof ProcessError && err.code === INVALID_ARGUMENT
    );
    await assert.rejects(
      executeCommand("dummy", [], { timeoutMs: NaN }),
      (err: any) => err instanceof ProcessError && err.code === INVALID_ARGUMENT
    );
    await assert.rejects(
      executeCommand("dummy", [], { timeoutMs: Infinity }),
      (err: any) => err instanceof ProcessError && err.code === INVALID_ARGUMENT
    );

    // timeoutMs 为 0 表示无上限，正常通过参数校验
    const zeroTimeoutDriver = new BarrierTestDriver();
    zeroTimeoutDriver.onSpawn = (spec, observer) => {
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
      return { id: "zero-timeout" };
    };
    const res = await executeCommand("dummy", [], { driver: zeroTimeoutDriver, timeoutMs: 0 });
    assert.strictEqual(res.status, 0);
  });

  it("参数数组原样透传，绝不启用 Shell 或 join 拼接命令字符串", async () => {
    let capturedExecutable = "";
    let capturedArgs: readonly string[] = [];

    const driver = new BarrierTestDriver();
    driver.onSpawn = (spec, observer) => {
      capturedExecutable = spec.executable;
      capturedArgs = spec.args;

      setTimeout(() => {
        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      }, 10);

      return { id: "args-handle", pid: 66001 };
    };

    const rawArgs = ["arg with spaces", "semi;colon", "pipe|symbol", "$VAR", "quote'\""];
    const result = await executeCommand("my-tool", rawArgs, { driver });

    assert.strictEqual(capturedExecutable, "my-tool");
    assert.deepStrictEqual(capturedArgs, rawArgs);
    assert.strictEqual(result.status, 0);
  });

  it("未传 env 时显式复制 process.env 且不修改 DEFAULT_ENV_ALLOWLIST", async () => {
    const customKey = "CUSTOM_NON_ALLOWLIST_CONFIG_XYZ";
    process.env[customKey] = "special_secret_token_123";

    try {
      assert.strictEqual(DEFAULT_ENV_ALLOWLIST.includes(customKey), false);

      const result = await executeCommand(process.execPath, [
        "-e",
        `process.stdout.write(process.env['${customKey}'] || 'missing');`,
      ]);

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, "special_secret_token_123");
      assert.strictEqual(DEFAULT_ENV_ALLOWLIST.includes(customKey), false);
    } finally {
      delete process.env[customKey];
    }
  });

  it("显式传入 options.env 时使用指定环境变量", async () => {
    const result = await executeCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.env['INJECTED_VAR'] || 'missing');"],
      {
        env: {
          PATH: process.env.PATH,
          INJECTED_VAR: "explicit_injected_value",
        },
      }
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, "explicit_injected_value");
  });

  it("派生后自动发送 stdin EOF，防止子进程等待输入导致死锁挂起", async () => {
    const result = await executeCommand(process.execPath, [
      "-e",
      "process.stdin.on('end', () => { process.stdout.write('stdin-closed'); process.exit(0); }); process.stdin.resume();",
    ]);

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, "stdin-closed");
  });

  it("支持同步测试桩驱动在 spawn 内部立即触发全部事件", async () => {
    const driver = new BarrierTestDriver();
    driver.onSpawn = (spec, observer) => {
      observer.output("stdout", new TextEncoder().encode("sync-out"));
      observer.output("stderr", new TextEncoder().encode("sync-err"));
      observer.exited({ code: 0, signal: null });
      observer.outputClosed("natural");
      return { id: "sync-handle", pid: 66002 };
    };

    const result = await executeCommand("dummy", [], { driver });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, "sync-out");
    assert.strictEqual(result.stderr, "sync-err");
  });

  it("输出尾部在 exit 后 close 前到达仍能被完整捕获", async () => {
    const driver = new BarrierTestDriver();
    driver.onSpawn = (spec, observer) => {
      setTimeout(() => {
        observer.output("stdout", new TextEncoder().encode("front-data;"));
        observer.exited({ code: 0, signal: null });

        setTimeout(() => {
          observer.output("stdout", new TextEncoder().encode("trailing-data;"));
          observer.outputClosed("natural");
        }, 20);
      }, 10);

      return { id: "trailing-handle", pid: 66003 };
    };

    const result = await executeCommand("dummy", [], { driver });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, "front-data;trailing-data;");
  });

  it("跨分块 UTF-8 多字节字符解码保证完整且不出现乱码", async () => {
    const text = "世界你好！ActionDock 2.x 跨块测试";
    const fullBytes = new TextEncoder().encode(text);
    const part1 = fullBytes.subarray(0, 7);
    const part2 = fullBytes.subarray(7);

    const onOutputChunks: string[] = [];
    const driver = new BarrierTestDriver();
    driver.onSpawn = (spec, observer) => {
      setTimeout(() => {
        observer.output("stdout", part1);
        setTimeout(() => {
          observer.output("stdout", part2);
          observer.exited({ code: 0, signal: null });
          observer.outputClosed("natural");
        }, 15);
      }, 10);

      return { id: "chunk-handle", pid: 66004 };
    };

    const result = await executeCommand("dummy", [], {
      driver,
      onOutput(stream, chunkText) {
        if (stream === "stdout") {
          onOutputChunks.push(chunkText);
        }
      },
    });

    assert.strictEqual(result.stdout, text);
    assert.strictEqual(onOutputChunks.join(""), text);
    assert.strictEqual(result.stdout.includes("\uFFFD"), false);
  });

  it("支持每流按字节有界捕获且数据切片独立深拷贝脱离底层缓冲区", async () => {
    const forwardedChunks: string[] = [];
    const maxOutputBytes = 12;

    // 构造一个共享底层大 Buffer 的切片
    const bigBuffer = Buffer.alloc(1024, 0);
    bigBuffer.write("12345678ABCDEFGHXYZ", 0, "utf-8");

    const driver = new BarrierTestDriver();
    driver.onSpawn = (spec, observer) => {
      setTimeout(() => {
        const u8 = new Uint8Array(bigBuffer.buffer, bigBuffer.byteOffset, 19);
        observer.output("stdout", u8.subarray(0, 8));  // "12345678"
        observer.output("stdout", u8.subarray(8, 16)); // "ABCDEFGH"
        observer.output("stdout", u8.subarray(16, 19)); // "XYZ"

        // 模拟底层驱动在发出数据后立即复写自身缓冲区，验证已捕获数据不受篡改
        bigBuffer.fill("Q");

        observer.exited({ code: 0, signal: null });
        observer.outputClosed("natural");
      }, 10);

      return { id: "limit-handle", pid: 66005 };
    };

    const result = await executeCommand("dummy", [], {
      driver,
      maxOutputBytes,
      onOutput(stream, text) {
        forwardedChunks.push(text);
      },
    });

    // 捕获的输出被深拷贝截断为前 12 字节且未被随后的 "Q" 覆写
    assert.strictEqual(result.stdout, "12345678ABCD");
    assert.strictEqual(result.truncated, true);

    // onOutput 实时转发所有 19 字节
    assert.strictEqual(forwardedChunks.join(""), "12345678ABCDEFGHXYZ");
  });

  it("onOutput 回调抛错时真实等待 driver.terminate 屏障后收敛终止并向外报告错误", async () => {
    const customError = new Error("onOutput crash intentionally");
    let releaseTerminateBarrier!: () => void;
    let observerRef!: ProcessObserver;

    const driver = new BarrierTestDriver();
    let notifyTerminate!: () => void;
    const terminateCalledPromise = new Promise<void>((resolve) => { notifyTerminate = resolve; });
    driver.onSpawn = (_spec, observer) => {
      observerRef = observer;
      setTimeout(() => observer.output("stdout", new TextEncoder().encode("trigger-error")), 10);
      return { id: "onoutput-err-handle" };
    };
    driver.onTerminate = async (_handle, graceMs) => {
      assert.strictEqual(graceMs, 0);
      notifyTerminate();
      await new Promise<void>((resolve) => { releaseTerminateBarrier = resolve; });
      observerRef.exited({ code: null, signal: "SIGKILL" });
      observerRef.outputClosed("natural");
    };
    const cmdPromise = executeCommand("dummy", [], { driver, onOutput() { throw customError; } });
    let settled = false;
    const rejection = assert.rejects(cmdPromise, (error) => error === customError).finally(() => { settled = true; });
    await terminateCalledPromise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(settled, false);
    releaseTerminateBarrier();
    await rejection;
  });

  it("执行超时时通过顶层 driver.terminate 屏障收敛并抛出 PROCESS_TIMEOUT 异常", async () => {
    let releaseBarrier!: () => void;
    let observerRef!: ProcessObserver;
    const driver = new BarrierTestDriver();

    const terminateCalledPromise = new Promise<void>((r) => {
      driver.onSpawn = (spec, observer) => {
        observerRef = observer;
        return { id: "timeout-handle" };
      };
      driver.onTerminate = async () => {
        r();
        await new Promise<void>((res) => {
          releaseBarrier = res;
        });
        observerRef.outputClosed("host-lost");
      };
    });

    const cmdPromise = executeCommand("dummy", [], {
      driver,
      timeoutMs: 25,
    });

    await terminateCalledPromise;

    // 断言屏障放行前处于 pending 状态
    let settled = false;
    cmdPromise.catch(() => {}).finally(() => { settled = true; });
    await new Promise((res) => setTimeout(res, 20));
    assert.strictEqual(settled, false);

    // 放行屏障，等待真实 outputClosed 后抛出 PROCESS_TIMEOUT
    releaseBarrier();
    await assert.rejects(cmdPromise, (err: any) => {
      assert.ok(err instanceof ProcessError);
      assert.strictEqual(err.code, PROCESS_TIMEOUT);
      return true;
    });
  });

  it("信号在启动前已 aborted 时直接以 PROCESS_CANCELLED 拒绝且不派生句柄", async () => {
    let spawnCalled = false;
    const driver = new BarrierTestDriver();
    driver.onSpawn = () => {
      spawnCalled = true;
      throw new Error("should not spawn");
    };

    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));

    await assert.rejects(
      executeCommand("dummy", [], {
        driver,
        signal: controller.signal,
      }),
      (err: any) => {
        assert.ok(err instanceof ProcessError);
        assert.strictEqual(err.code, PROCESS_CANCELLED);
        return true;
      }
    );

    assert.strictEqual(spawnCalled, false);
  });

  it("派生期间 signal abort 时拿到 handle 后仍必须等待 driver.terminate 屏障收敛", async () => {
    let releaseBarrier!: () => void;
    let observerRef!: ProcessObserver;
    const controller = new AbortController();
    const driver = new BarrierTestDriver();

    const terminateCalledPromise = new Promise<void>((r) => {
      driver.onSpawn = async (spec, observer) => {
        observerRef = observer;
        // 模拟慢速派生，并在返回 handle 之前触发中止
        await new Promise((res) => setTimeout(res, 20));
        controller.abort(new Error("aborted during spawn"));
        await new Promise((res) => setTimeout(res, 10));
        return { id: "slow-spawn-handle" };
      };

      driver.onTerminate = async () => {
        r();
        await new Promise<void>((res) => {
          releaseBarrier = res;
        });
        observerRef.outputClosed("host-lost");
      };
    });

    const cmdPromise = executeCommand("dummy", [], {
      driver,
      signal: controller.signal,
    });

    await terminateCalledPromise;

    // 断言屏障放行前处于 pending
    let settled = false;
    cmdPromise.catch(() => {}).finally(() => { settled = true; });
    await new Promise((res) => setTimeout(res, 20));
    assert.strictEqual(settled, false);

    releaseBarrier();
    await assert.rejects(cmdPromise, (err: any) => {
      assert.ok(err instanceof ProcessError);
      assert.strictEqual(err.code, PROCESS_CANCELLED);
      return true;
    });
  });

  it("运行期间 signal abort 时调用顶层 driver.terminate 等待屏障收敛后抛出 PROCESS_CANCELLED", async () => {
    let releaseBarrier!: () => void;
    let observerRef!: ProcessObserver;
    const controller = new AbortController();
    const driver = new BarrierTestDriver();

    const terminateCalledPromise = new Promise<void>((r) => {
      driver.onSpawn = (spec, observer) => {
        observerRef = observer;
        setTimeout(() => {
          controller.abort(new Error("aborted while running"));
        }, 15);
        return { id: "running-handle" };
      };

      driver.onTerminate = async () => {
        r();
        await new Promise<void>((res) => {
          releaseBarrier = res;
        });
        observerRef.outputClosed("host-lost");
      };
    });

    const cmdPromise = executeCommand("dummy", [], {
      driver,
      signal: controller.signal,
    });

    await terminateCalledPromise;

    let settled = false;
    cmdPromise.catch(() => {}).finally(() => { settled = true; });
    await new Promise((res) => setTimeout(res, 20));
    assert.strictEqual(settled, false);

    releaseBarrier();
    await assert.rejects(cmdPromise, (err: any) => {
      assert.ok(err instanceof ProcessError);
      assert.strictEqual(err.code, PROCESS_CANCELLED);
      return true;
    });
  });

  it("真实可执行文件不存在时（NodeProcessDriver 异步 ENOENT）必须终结为 PROCESS_SPAWN_ERROR 并保留 cause", async () => {
    const driver = new NodeProcessDriver();

    await assert.rejects(
      executeCommand("this_executable_does_not_exist_at_all_12345", ["arg"], { driver }),
      (err: any) => {
        assert.ok(err instanceof ProcessError);
        assert.strictEqual(err.code, PROCESS_SPAWN_ERROR);
        assert.ok(err.details?.cause);
        return true;
      }
    );
  });

  it("inputEOF 遇到非关闭类的实质错误时必须触发收敛并向外透明抛出", async () => {
    const inputError = new Error("inputEOF hardware failure");
    let terminated = false;
    const driver = new BarrierTestDriver();
    let observerRef!: ProcessObserver;
    driver.onSpawn = (_spec, observer) => {
      observerRef = observer;
      return { id: "input-eof-fail" };
    };
    driver.onInputEOF = async () => {
      throw inputError;
    };
    driver.onTerminate = async () => {
      terminated = true;
      observerRef.exited({ code: null, signal: "SIGKILL" });
      observerRef.outputClosed("natural");
    };

    // 验证实质性输入错误被透明抛出且触发了终止收敛
    await assert.rejects(
      executeCommand("dummy", [], { driver }),
      (err) => err === inputError
    );
    assert.strictEqual(terminated, true);
  });

  it("根进程 exit 后孙进程再写 tail 时 executeCommand 仍完整捕获并等待闭合", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX 进程组树特定测试");
      return;
    }

    // 父进程派生后台孙进程，孙进程等待 30ms 后写入 tail-finish，父进程自身先 exit 0
    const parentScript = `
      const { spawn } = require("node:child_process");
      const grandChild = spawn(
        process.execPath,
        ["-e", "setTimeout(() => { process.stdout.write('tail-finish\\\\n'); process.exit(0); }, 30);"],
        { stdio: ["ignore", "inherit", "ignore"] }
      );
      process.exit(0);
    `;

    const result = await executeCommand(process.execPath, ["-e", parentScript]);

    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes("tail-finish"));
  });

  it("根进程先 exit、孙进程持有管道时触发 abort 仍能强杀收敛并等 outputClosed", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX 进程组树特定测试");
      return;
    }

    const controller = new AbortController();

    // 父进程派生忽略 SIGTERM 且持有 stdout 的孙进程，并在孙进程就绪打印 READY 后父进程 exit 0
    const parentScript = `
      const { spawn } = require("node:child_process");
      const grandChild = spawn(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);"],
        { stdio: ["ignore", "inherit", "ignore", "ipc"] }
      );
      grandChild.once("message", () => { process.stdout.write("READY\\n"); process.exit(0); });
    `;

    let readySeen = false;
    const driver = new NodeProcessDriver();
    const spawn = driver.spawn.bind(driver);
    driver.spawn = (spec, observer) => spawn(spec, {
      ...observer,
      exited(result) {
        observer.exited(result);
        controller.abort(new Error("abort after parent exited"));
      },
    });
    const cmdPromise = executeCommand(process.execPath, ["-e", parentScript], {
      driver,
      signal: controller.signal,
      onOutput(_stream, text) {
        if (text.includes("READY")) readySeen = true;
      },
    });

    await assert.rejects(cmdPromise, (err: any) => {
      assert.ok(err instanceof ProcessError);
      assert.strictEqual(err.code, PROCESS_CANCELLED);
      return true;
    });

    assert.strictEqual(readySeen, true);
  });

  it("outputClosed 为 drain-timeout 时明确以 PROCESS_TIMEOUT 失败并触发 terminate 清理且不成功返回", async () => {
    let terminated = false;
    let terminateGraceMs: number | undefined;
    const driver = new BarrierTestDriver();
    let observerRef!: ProcessObserver;

    driver.onSpawn = (_spec, observer) => {
      observerRef = observer;
      return { id: "drain-timeout-handle", pid: 99111 };
    };

    driver.onTerminate = async (_handle, graceMs) => {
      terminated = true;
      terminateGraceMs = graceMs;
    };

    const cmdPromise = executeCommand("dummy", ["arg"], { driver });

    await Promise.resolve();
    observerRef.exited({ code: 0, signal: null });
    observerRef.output("stdout", new TextEncoder().encode("partial-output-before-timeout"));
    observerRef.outputClosed("drain-timeout");

    await assert.rejects(
      cmdPromise,
      (err: any) => {
        assert.ok(err instanceof ProcessError);
        assert.strictEqual(err.code, PROCESS_TIMEOUT);
        assert.ok(err.message.includes("drain timed out"));
        assert.strictEqual(err.details?.executable, "dummy");
        return true;
      }
    );

    assert.strictEqual(terminated, true);
    assert.strictEqual(terminateGraceMs, 200);
  });

  it("outputClosed 为 host-lost 时明确以 PROCESS_SPAWN_ERROR 失败并触发 terminate 清理", async () => {
    let terminated = false;
    const driver = new BarrierTestDriver();
    let observerRef!: ProcessObserver;

    driver.onSpawn = (_spec, observer) => {
      observerRef = observer;
      return { id: "host-lost-handle", pid: 99112 };
    };

    driver.onTerminate = async () => {
      terminated = true;
    };

    const cmdPromise = executeCommand("dummy", ["arg"], { driver });
    await Promise.resolve();
    observerRef.outputClosed("host-lost");

    await assert.rejects(
      cmdPromise,
      (err: any) => {
        assert.ok(err instanceof ProcessError);
        assert.strictEqual(err.code, PROCESS_SPAWN_ERROR);
        assert.ok(err.message.includes("host connection was lost"));
        assert.strictEqual(err.details?.executable, "dummy");
        return true;
      }
    );

    assert.strictEqual(terminated, true);
  });

  it("输出关闭或触发中止后迟到的 output 事件不得继续派发给 onOutput 回调或追加缓冲", async () => {
    const driver = new BarrierTestDriver();
    let observerRef!: ProcessObserver;
    const outputEvents: string[] = [];

    driver.onSpawn = (_spec, observer) => {
      observerRef = observer;
      return { id: "late-output-handle" };
    };

    const cmdPromise = executeCommand("dummy", [], {
      driver,
      onOutput(_stream, text) {
        outputEvents.push(text);
      },
    });

    await Promise.resolve();
    observerRef.output("stdout", new TextEncoder().encode("valid-output\n"));
    observerRef.exited({ code: 0, signal: null });
    observerRef.outputClosed("natural");

    const result = await cmdPromise;
    assert.strictEqual(result.stdout, "valid-output\n");
    assert.deepStrictEqual(outputEvents, ["valid-output\n"]);

    // 在 closed 后注入延迟输出，必须被观察者静默丢弃，不得触发回调或污染结果
    observerRef.output("stdout", new TextEncoder().encode("late-garbage\n"));
    assert.strictEqual(result.stdout, "valid-output\n");
    assert.deepStrictEqual(outputEvents, ["valid-output\n"]);
  });

  it("外部 signal 取消时保持调用 terminate 清理并抛出 PROCESS_CANCELLED，不会被误包装为其他错误", async () => {
    let terminated = false;
    const controller = new AbortController();
    const driver = new BarrierTestDriver();
    let observerRef!: ProcessObserver;

    driver.onSpawn = (_spec, observer) => {
      observerRef = observer;
      return { id: "cancel-clean-handle" };
    };

    driver.onTerminate = async () => {
      terminated = true;
      observerRef.outputClosed("natural");
    };

    const cmdPromise = executeCommand("dummy", [], {
      driver,
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort("user aborted intentionally");

    await assert.rejects(cmdPromise, (err: any) => {
      assert.ok(err instanceof ProcessError);
      assert.strictEqual(err.code, PROCESS_CANCELLED);
      return true;
    });

    assert.strictEqual(terminated, true);
  });

  it("父进程先退出但后台后代持续执行并在 5s 默认排空期限后自然写入完成时，默认执行器完整捕获输出并成功返回", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX 包装脚本特定测试");
      return;
    }

    // 模拟类似 npm 包装脚本模式：父脚本派生孙进程并立即退出，
    // 孙进程在 5200ms（超过 NodeProcessDriver 默认 5000ms 排空时限）后写入完成标记并正常退出。
    // 在 waitForOutputClose: true 驱动下，执行器必须保持等待管道自然关闭，完整捕获输出并返回 status 0。
    const parentScript = `
      const { spawn } = require("node:child_process");
      const grandChild = spawn(
        process.execPath,
        ["-e", "setTimeout(() => { process.stdout.write('npm-delayed-success\\\\n'); process.exit(0); }, 5200);"],
        { stdio: ["ignore", "inherit", "inherit"] }
      );
      grandChild.unref();
      process.exit(0);
    `;

    const start = Date.now();
    const result = await executeCommand(process.execPath, ["-e", parentScript], {
      timeoutMs: 15000,
    });

    const elapsed = Date.now() - start;
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes("npm-delayed-success"));
    assert.ok(elapsed >= 5000, `耗时必须大于 5000ms（实际耗时 ${elapsed}ms）以验证穿透默认排空期限`);
  });

  it("外部驱动触发 drain-timeout 时必须执行 terminate 强杀孤儿进程树，错误抛出后后台后代彻底消亡", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX 进程组树特定测试");
      return;
    }

    const driver = new NodeProcessDriver({ drainDeadlineMs: 300 });
    let grandPid: number | undefined;
    let returned = false;
    let lateCallbacks = 0;

    const grandCode = `
      process.on("SIGTERM", () => {});
      process.stdout.write("GRAND_PID=" + process.pid + "\\n");
      setInterval(() => process.stdout.write("tick\\n"), 100);
    `;
    const parentCode = `
      const { spawn } = require("node:child_process");
      const c = spawn(process.execPath, ["-e", ${JSON.stringify(grandCode)}], { stdio: ["ignore", "inherit", "inherit"] });
      c.unref();
      process.exit(0);
    `;

    let caughtError: any;
    try {
      await executeCommand(process.execPath, ["-e", parentCode], {
        driver,
        onOutput(_stream, text) {
          if (returned) {
            lateCallbacks++;
          }
          const match = text.match(/GRAND_PID=(\d+)/);
          if (match) grandPid = Number(match[1]);
        },
      });
    } catch (err) {
      returned = true;
      caughtError = err;
    }

    assert.ok(caughtError instanceof ProcessError);
    assert.strictEqual(caughtError.code, PROCESS_TIMEOUT);
    assert.ok(caughtError.message.includes("drain timed out"));
    assert.ok(grandPid !== undefined, "必须成功捕获孙进程 PID");

    // 等待 200ms 确认终止收敛：孙进程必须已被 SIGKILL 清理，且终态后绝不再收到 onOutput 回调
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(lateCallbacks, 0, "终态到达后绝不再触发 onOutput 回调");

    let alive = false;
    try {
      process.kill(grandPid!, 0);
      alive = true;
      process.kill(grandPid!, "SIGKILL");
    } catch {}
    assert.strictEqual(alive, false, "孙进程必须在 drain-timeout 发生后被彻底强杀清理，绝不得后台遗留");
  });
});
