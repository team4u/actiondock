import childProcess, { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { Capabilities, LaunchSpec } from "@actiondock/sdk";
import {
  INPUT_CLOSED,
  UNSUPPORTED_CAPABILITY,
  ProcessError,
  type ProcessDriver,
  type ProcessDriverCallbacks,
  type ProcessDriverHandle,
  type ProcessHandle,
  type ProcessObserver,
  DEFAULT_ENV_ALLOWLIST,
  resolveProcessEnv,
} from "@actiondock/core";
import { killProcessGroup } from "./process-executor";

/**
 * 环境变量解析单一事实源：位于 core 的 resolveProcessEnv（严格 allowlist 白名单、none 与 set/unset 策略）。
 * 本模块 re-export 维持既有导入路径兼容，进程执行器与驱动共用同一份实现，杜绝策略漂移。
 */
export { DEFAULT_ENV_ALLOWLIST, resolveProcessEnv };
export type { ProcessDriver, ProcessObserver, ProcessHandle };

/**
 * NodeProcessDriver 初始化选项。
 */
export interface NodeProcessDriverOptions {
  /** 进程 exit 后 stdio 未 close 的最长等待排空时限（毫秒），默认为 5000 */
  drainDeadlineMs?: number;
  /** 进程派生函数，默认为 childProcess.spawn */
  spawnFn?: typeof spawn;
}

/**
 * 内部受管进程实例上下文。
 */
interface InternalProcessInstance {
  id: string;
  pid?: number;
  child: ChildProcess;
  observer: ProcessObserver;
  mode: "pipe" | "pty";
  ptyProcess?: any;
  exited: boolean;
  outputClosed: boolean;
  exitResult?: { code: number | null; signal: string | null };
  drainTimer?: NodeJS.Timeout;
  exitListeners: Array<() => void>;
  onExit(callback: () => void): void;
  cleanup(): void;
}

/**
 * node-pty 探测结果模块级缓存：getCapabilities 处于 spawn 热路径，
 * createRequire 与 require 探测开销只需在首次调用时执行一次。
 */
let cachedCapabilities: Capabilities | undefined;

/**
 * 基于 Node.js 标准子进程实现的平台驱动。
 * 遵循《ActionDock Managed Process 设计 v2》第 11、12 节规范：
 * - pipe 模式采用 child_process.spawn，支持进程组隔离与跨平台 killProcessGroup
 * - 输出与生命周期监听在 spawn 返回前完成绑定，杜绝竞态丢失
 * - 环境变量按 allowlisted 白名单与 none 策略严格继承，叠加 set 与 unset 变更
 * - 写入支持背压流控与管道提早关闭异常捕获
 * - 输入流支持 inputEOF 干净终止
 * - 支持 5s 优雅输出排空 deadline 与 outputClosed 状态上报
 * - PTY 模式在无 node-pty 环境明确拒绝并报告 UNSUPPORTED_CAPABILITY
 */
export class NodeProcessDriver implements ProcessDriver {
  private readonly drainDeadlineMs: number;
  private readonly spawnFn: typeof spawn;
  private readonly instances = new Map<string, InternalProcessInstance>();

  constructor(options: NodeProcessDriverOptions = {}) {
    this.drainDeadlineMs = options.drainDeadlineMs ?? 5000;
    this.spawnFn = options.spawnFn ?? childProcess.spawn;
  }

  /**
   * 获取驱动支持的运行时能力集。
   */
  getCapabilities(): Capabilities {
    if (cachedCapabilities) {
      return { ...cachedCapabilities };
    }

    let ptySupported = false;
    try {
      const cjsRequire = createRequire(import.meta.url);
      cjsRequire("node-pty");
      ptySupported = true;
    } catch {
      ptySupported = false;
    }

    cachedCapabilities = {
      pty: ptySupported,
      resize: ptySupported,
      inputEOF: true,
      interruptForeground: process.platform !== "win32",
      terminationScope: "process-tree",
    };
    return { ...cachedCapabilities };
  }

  /**
   * 依据《Managed Process 设计 v2》标准契约启动受管进程。
   * 同时兼容旧版重载签名。
   */
  spawn(spec: LaunchSpec, observer: ProcessObserver): Promise<ProcessHandle>;
  spawn(
    processId: string,
    spec: LaunchSpec,
    callbacks: ProcessDriverCallbacks
  ): Promise<ProcessDriverHandle>;
  async spawn(
    specOrProcessId: LaunchSpec | string,
    observerOrSpec: ProcessObserver | LaunchSpec,
    maybeCallbacks?: ProcessDriverCallbacks
  ): Promise<any> {
    if (typeof specOrProcessId === "string") {
      const processId = specOrProcessId;
      const spec = observerOrSpec as LaunchSpec;
      const callbacks = maybeCallbacks!;
      return this.spawnLegacy(processId, spec, callbacks);
    }

    const spec = specOrProcessId;
    const observer = observerOrSpec as ProcessObserver;
    return this.spawnStandard(spec, observer);
  }

  /**
   * 标准接口派生受管进程实现。
   */
  private async spawnStandard(
    spec: LaunchSpec,
    observer: ProcessObserver,
    customId?: string
  ): Promise<ProcessHandle> {
    if (spec.io.mode === "pty") {
      return this.spawnPty(spec as LaunchSpec & { io: { mode: "pty" } }, observer, customId);
    }
    return this.spawnPipe(spec, observer, customId);
  }

  /**
   * PTY 模式派生：检查运行环境能力，若缺失 node-pty 则明确抛出异常。
   */
  private async spawnPty(
    spec: LaunchSpec & { io: { mode: "pty" } },
    observer: ProcessObserver,
    customId?: string
  ): Promise<ProcessHandle> {
    let ptyModule: any;
    try {
      const cjsRequire = createRequire(import.meta.url);
      ptyModule = cjsRequire("node-pty");
    } catch (err: any) {
      throw new ProcessError(
        UNSUPPORTED_CAPABILITY,
        `PTY mode is not supported because node-pty is unavailable: ${err?.message || String(err)}`
      );
    }

    const handleId = customId ?? randomUUID();
    const env = resolveProcessEnv(spec.env);
    const cols = spec.io.cols ?? 80;
    const rows = spec.io.rows ?? 24;
    const name = spec.io.term ?? "xterm-256color";

    let ptyProcess: any;
    try {
      ptyProcess = ptyModule.spawn(spec.executable, spec.args, {
        name,
        cols,
        rows,
        cwd: spec.cwd,
        env,
      });
    } catch (err: any) {
      const faultError = err instanceof Error ? err : new Error(String(err));
      observer.fault?.(faultError);
      observer.exited({ code: null, signal: null });
      observer.outputClosed("natural");
      throw faultError;
    }

    const exitListeners: Array<() => void> = [];
    const instance: InternalProcessInstance = {
      id: handleId,
      pid: ptyProcess.pid,
      child: ptyProcess as unknown as ChildProcess,
      observer,
      mode: "pty",
      ptyProcess,
      exited: false,
      outputClosed: false,
      exitListeners,
      onExit(cb) {
        if (instance.exited) {
          cb();
        } else {
          exitListeners.push(cb);
        }
      },
      cleanup() {
        if (instance.drainTimer) {
          clearTimeout(instance.drainTimer);
          instance.drainTimer = undefined;
        }
        exitListeners.length = 0;
      },
    };

    const markExited = (code: number | null, signal: string | null) => {
      if (!instance.exited) {
        instance.exited = true;
        instance.exitResult = { code, signal };
        observer.exited({ code, signal });
        for (const listener of exitListeners) {
          listener();
        }
      }
    };

    const markOutputClosed = (reason: "natural" | "drain-timeout" | "host-lost") => {
      if (instance.drainTimer) {
        clearTimeout(instance.drainTimer);
        instance.drainTimer = undefined;
      }
      if (!instance.outputClosed) {
        instance.outputClosed = true;
        observer.outputClosed(reason);
      }
    };

    // 绑定 PTY 数据输出
    ptyProcess.onData((data: string) => {
      observer.output("pty", new TextEncoder().encode(data));
    });

    ptyProcess.onExit((e: { exitCode: number; signal?: number }) => {
      const signalStr = e.signal ? String(e.signal) : null;
      markExited(e.exitCode, signalStr);
      markOutputClosed("natural");
    });

    this.instances.set(handleId, instance);

    return this.createHandleObject(instance);
  }

  /**
   * pipe 模式派生：使用 child_process.spawn，同步完成监听绑定杜绝竞态。
   */
  private async spawnPipe(
    spec: LaunchSpec,
    observer: ProcessObserver,
    customId?: string
  ): Promise<ProcessHandle> {
    const handleId = customId ?? randomUUID();
    const env = resolveProcessEnv(spec.env);

    let child: ChildProcess;
    try {
      child = this.spawnFn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (err: any) {
      const faultError = err instanceof Error ? err : new Error(String(err));
      observer.fault?.(faultError);
      observer.exited({ code: null, signal: null });
      observer.outputClosed("natural");
      throw faultError;
    }

    const exitListeners: Array<() => void> = [];
    const instance: InternalProcessInstance = {
      id: handleId,
      pid: child.pid,
      child,
      observer,
      mode: "pipe",
      exited: false,
      outputClosed: false,
      exitListeners,
      onExit(cb) {
        if (instance.exited) {
          cb();
        } else {
          exitListeners.push(cb);
        }
      },
      cleanup() {
        if (instance.drainTimer) {
          clearTimeout(instance.drainTimer);
          instance.drainTimer = undefined;
        }
        exitListeners.length = 0;
      },
    };

    const markExited = (code: number | null, signal: string | null) => {
      if (!instance.exited) {
        instance.exited = true;
        instance.exitResult = { code, signal };
        observer.exited({ code, signal });
        for (const listener of exitListeners) {
          listener();
        }
      }
    };

    const markOutputClosed = (reason: "natural" | "drain-timeout" | "host-lost") => {
      if (instance.drainTimer) {
        clearTimeout(instance.drainTimer);
        instance.drainTimer = undefined;
      }
      if (!instance.outputClosed) {
        instance.outputClosed = true;
        observer.outputClosed(reason);
      }
    };

    // 同步完成 stdout/stderr 监听绑定，防止产生数据丢失竞态
    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        observer.output("stdout", new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        observer.output("stderr", new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      });
    }

    // 监听 stdin 错误避免未捕获 EPIPE 导致宿主异常退出
    if (child.stdin) {
      child.stdin.on("error", () => {
        // 忽略管道断开异常
      });
    }

    child.on("exit", (code, signal) => {
      markExited(code, signal);
      if (!instance.outputClosed && !instance.drainTimer) {
        instance.drainTimer = setTimeout(() => {
          markOutputClosed("drain-timeout");
        }, this.drainDeadlineMs);
        instance.drainTimer.unref?.();
      }
    });

    child.on("close", (code, signal) => {
      markExited(code, signal);
      markOutputClosed("natural");
    });

    child.on("error", (err: Error) => {
      instance.cleanup();
      observer.fault?.(err);
      markExited(null, null);
      markOutputClosed("natural");
    });

    this.instances.set(handleId, instance);

    return this.createHandleObject(instance);
  }

  /**
   * 构造对齐驱动操作的 ProcessHandle 对象。
   */
  private createHandleObject(instance: InternalProcessInstance): ProcessHandle & ProcessDriverHandle {
    return {
      id: instance.id,
      pid: instance.pid,
      write: (data: Uint8Array) => this.write(instance, data),
      sendInputEOF: () => this.inputEOF(instance),
      interruptForeground: () => this.interruptForeground(instance),
      resize: (cols: number, rows: number) => this.resize(instance, cols, rows),
      terminate: (graceMs: number) => this.terminate(instance, graceMs),
    };
  }

  /**
   * 向受管进程输入流写入字节数据，支持背压与管道提早关闭错误捕获。
   */
  async write(handle: ProcessHandle, data: Uint8Array): Promise<void> {
    const instance = this.resolveInstance(handle);

    if (instance.mode === "pty" && instance.ptyProcess) {
      const text = new TextDecoder().decode(data);
      instance.ptyProcess.write(text);
      return;
    }

    const stdin = instance.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      throw new ProcessError(INPUT_CLOSED, "Process stdin is closed or destroyed");
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        stdin.removeListener("error", onError);
        stdin.removeListener("drain", onDrain);
      };

      const onError = (err: Error) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new ProcessError(INPUT_CLOSED, `Failed to write to stdin: ${err.message}`));
        }
      };

      const onDrain = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      };

      stdin.once("error", onError);

      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const canContinue = stdin.write(buffer, (err) => {
        if (err) {
          onError(err);
        }
      });

      if (canContinue) {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      } else {
        stdin.once("drain", onDrain);
      }
    });
  }

  /**
   * 结束输入流写入，发送 EOF。
   */
  async inputEOF(handle: ProcessHandle): Promise<void> {
    const instance = this.resolveInstance(handle);
    if (instance.mode === "pty") {
      // PTY 模式下发送 EOF 控制符 Ctrl+D (\x04)
      if (instance.ptyProcess) {
        instance.ptyProcess.write("\x04");
      }
      return;
    }

    const stdin = instance.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      return;
    }

    return new Promise<void>((resolve) => {
      stdin.end(() => {
        resolve();
      });
    });
  }

  /**
   * 中断前台作业组。
   */
  async interruptForeground(handle: ProcessHandle): Promise<void> {
    const instance = this.resolveInstance(handle);
    const pid = instance.pid;
    if (!pid || instance.exited) {
      return;
    }

    if (instance.mode === "pty" && instance.ptyProcess) {
      // PTY 模式发送 Ctrl+C (\x03)
      instance.ptyProcess.write("\x03");
      return;
    }

    if (process.platform === "win32") {
      try {
        process.kill(pid, "SIGINT");
      } catch {
        // 忽略已退出状态
      }
    } else {
      try {
        process.kill(-pid, "SIGINT");
      } catch {
        try {
          process.kill(pid, "SIGINT");
        } catch {
          // 忽略已退出状态
        }
      }
    }
  }

  /**
   * 动态调整终端尺寸，仅 PTY 模式生效。
   */
  async resize(handle: ProcessHandle, cols: number, rows: number): Promise<void> {
    const instance = this.resolveInstance(handle);
    if (instance.mode !== "pty" || !instance.ptyProcess) {
      throw new ProcessError(
        UNSUPPORTED_CAPABILITY,
        "Terminal resize is unsupported in pipe mode"
      );
    }
    instance.ptyProcess.resize(cols, rows);
  }

  /**
   * 优雅终止进程，超时未退出则发送 SIGKILL 强杀兜底。
   */
  terminate(handle: ProcessHandle, graceMs: number): Promise<void>;
  terminate(processId: string, graceMs: number): Promise<void>;
  async terminate(handleOrId: ProcessHandle | string, graceMs: number): Promise<void> {
    const instance =
      typeof handleOrId === "string"
        ? this.instances.get(handleOrId)
        : this.resolveInstance(handleOrId);

    if (!instance) {
      return;
    }

    const pid = instance.pid;
    if (!pid || instance.exited) {
      return;
    }

    await killProcessGroup(pid, "SIGTERM", this.spawnFn);

    if (graceMs <= 0) {
      if (!instance.exited) {
        await killProcessGroup(pid, "SIGKILL", this.spawnFn);
      }
      return;
    }

    if (instance.exited) {
      return;
    }

    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      let exitFinish: (() => void) | undefined;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        // 完成后自注销本次注册的 exit 监听器，避免同一实例反复 terminate 时累积监听器
        if (exitFinish) {
          const idx = instance.exitListeners.indexOf(exitFinish);
          if (idx >= 0) {
            instance.exitListeners.splice(idx, 1);
          }
        }
        if (timer) clearTimeout(timer);
        resolve();
      };

      exitFinish = finish;
      instance.onExit(finish);

      timer = setTimeout(async () => {
        if (!instance.exited) {
          try {
            await killProcessGroup(pid, "SIGKILL", this.spawnFn);
          } catch {
            // 忽略终止失败异常
          }
        }
        finish();
      }, graceMs);
      timer.unref?.();
    });
  }

  /**
   * 销毁进程句柄并清理相关资源。
   */
  async dispose(handle: ProcessHandle): Promise<void> {
    const instance = this.instances.get(handle.id);
    if (instance) {
      instance.cleanup();
      this.instances.delete(handle.id);
    }
  }

  /**
   * 兼容旧版基于 processId 派生新进程。
   */
  private async spawnLegacy(
    processId: string,
    spec: LaunchSpec,
    callbacks: ProcessDriverCallbacks
  ): Promise<ProcessDriverHandle> {
    const observer: ProcessObserver = {
      output(stream, data) {
        callbacks.onOutput(stream, data);
      },
      exited(result) {
        callbacks.onExit(result);
      },
      outputClosed(reason) {
        callbacks.onOutputClosed?.(reason);
      },
      fault(err) {
        callbacks.onError(err);
      },
    };

    const handle = await this.spawnStandard(spec, observer, processId);
    return handle as unknown as ProcessDriverHandle;
  }

  /**
   * 解析查找内部受管进程实例。
   */
  private resolveInstance(handle: ProcessHandle): InternalProcessInstance {
    const instance = this.instances.get(handle.id);
    if (!instance) {
      throw new Error(`Process instance not found for handle id: ${handle.id}`);
    }
    return instance;
  }
}

/**
 * 兼容原有命名导出。
 */
export { NodeProcessDriver as ProcessDriverImpl };
