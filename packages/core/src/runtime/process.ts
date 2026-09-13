import {
  type CallOptions,
  type ControlGrant,
  type OperationReceipt,
  type ProcessAcquireInput,
  type ProcessAPI,
  type ProcessControlInput,
  type ProcessExecOptions,
  type ProcessInfo,
  type ProcessListInput,
  type ProcessListResult,
  type ProcessReadInput,
  type ProcessResult,
  type ProcessRunInput,
  type ProcessRunResult,
  type ProcessStartInput,
  type ProcessStartResult,
  type ProcessStopInput,
  type ProcessWriteInput,
  type ReadResult,
} from "@actiondock/sdk";
import { MemoryProcessDriver, ProcessManager, type ProcessOwner } from "../process";

export type ProcessExecutor = ProcessAPI;

/**
 * 基于受管进程驱动的默认基础执行器实现。
 * 保持内核彻底解耦与平台无关，不依赖操作系统原生进程句柄与 Node 模块。
 */
export class DefaultProcessExecutor implements ProcessExecutor {
  private readonly manager: ProcessManager;
  private readonly owner: ProcessOwner;

  constructor(manager?: ProcessManager, owner?: ProcessOwner) {
    this.manager = manager ?? new ProcessManager({ driver: new MemoryProcessDriver() });
    this.owner = owner ?? {
      tenantId: "default",
      principalId: "default",
      packageInstanceId: "default",
      generationId: "default",
    };
  }

  async exec(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    try {
      const runResult = await this.manager.run(
        this.owner,
        {
          spec: {
            executable: command,
            args,
            cwd: options.cwd,
            env: options.env ? { inherit: "none", set: options.env } : undefined,
            io: { mode: "pipe" },
          },
          timeoutMs: options.timeoutMs ?? 0,
          maxOutputBytes: options.maxOutputBytes ?? 10 * 1024 * 1024,
        },
        options.signal ? { signal: options.signal } : undefined
      );

      let stdout = "";
      let stderr = "";
      for (const chunk of runResult.chunks) {
        if (chunk.stream === "stdout") {
          stdout += chunk.data.data;
        } else if (chunk.stream === "stderr") {
          stderr += chunk.data.data;
        }
      }

      const durationMs = Date.now() - startTime;
      const ok = runResult.exit.code === 0;

      if (!ok && options.throwOnError) {
        throw new Error(stderr || `Process exited with code ${runResult.exit.code}`);
      }

      return {
        ok,
        exitCode: runResult.exit.code,
        signal: runResult.exit.signal ?? undefined,
        stdout,
        stderr,
        raw: new Uint8Array(),
        timedOut: false,
        cancelled: false,
        durationMs,
      };
    } catch (err: any) {
      if (options.throwOnError) {
        throw err;
      }
      return {
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: err?.message || String(err),
        raw: new Uint8Array(),
        timedOut: false,
        cancelled: false,
        durationMs: Date.now() - startTime,
        error: {
          code: err?.code || "PROCESS_FAILED",
          message: err?.message || String(err),
        },
      };
    }
  }

  async spawn(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    return this.exec(command, args, options);
  }

  async run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult> {
    return this.manager.run(this.owner, input, call);
  }

  async start(input: ProcessStartInput, call?: CallOptions): Promise<ProcessStartResult> {
    return this.manager.start(this.owner, input, call);
  }

  async inspect(id: string, call?: CallOptions): Promise<ProcessInfo> {
    return this.manager.inspect(this.owner, id, call);
  }

  async list(input: ProcessListInput, call?: CallOptions): Promise<ProcessListResult> {
    return this.manager.list(this.owner, input, call);
  }

  async acquire(id: string, input: ProcessAcquireInput, call?: CallOptions): Promise<ControlGrant> {
    return this.manager.acquire(this.owner, id, input, call);
  }

  async renew(id: string, token: string, ttlMs: number, call?: CallOptions): Promise<ControlGrant> {
    return this.manager.renew(this.owner, id, token, ttlMs, call);
  }

  async release(id: string, token: string, call?: CallOptions): Promise<void> {
    return this.manager.release(this.owner, id, token, call);
  }

  async write(id: string, input: ProcessWriteInput, call?: CallOptions): Promise<OperationReceipt> {
    return this.manager.write(this.owner, id, input, call);
  }

  async operation(id: string, requestId: string, call?: CallOptions): Promise<OperationReceipt> {
    return this.manager.operation(this.owner, id, requestId, call);
  }

  async read(id: string, input: ProcessReadInput, call?: CallOptions): Promise<ReadResult> {
    return this.manager.read(this.owner, id, input, call);
  }

  async control(id: string, input: ProcessControlInput, call?: CallOptions): Promise<OperationReceipt> {
    return this.manager.control(this.owner, id, input, call);
  }

  async stop(id: string, input: ProcessStopInput, call?: CallOptions): Promise<ProcessInfo> {
    return this.manager.stop(this.owner, id, input, call);
  }
}
