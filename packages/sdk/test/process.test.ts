import { describe, expect, it } from "bun:test";
import {
  createStreamDecoder,
  decodeBytes,
  decodeText,
  encodeBytes,
  encodeText,
  withControl,
} from "../src/process";
import type {
  Bytes,
  ControlGrant,
  LaunchSpec,
  OperationReceipt,
  OutputChunk,
  ProcessAPI,
  ProcessInfo,
  ReadResult,
} from "../src/types";

describe("Managed Process 编码与解码辅助函数", () => {
  it("encodeBytes 支持字符串与 Uint8Array 编码为标准 base64 Bytes", () => {
    const fromStr = encodeBytes("hello world");
    expect(fromStr.encoding).toBe("base64");
    expect(fromStr.data).toBe(Buffer.from("hello world").toString("base64"));

    const raw = new Uint8Array([1, 2, 3, 4, 5]);
    const fromU8 = encodeBytes(raw);
    expect(fromU8.encoding).toBe("base64");
    expect(fromU8.data).toBe(Buffer.from([1, 2, 3, 4, 5]).toString("base64"));

    // 验证子切片偏移处理
    const sub = raw.subarray(1, 4);
    const fromSub = encodeBytes(sub);
    expect(fromSub.data).toBe(Buffer.from([2, 3, 4]).toString("base64"));

    // 验证空数据编码
    expect(encodeBytes("").data).toBe("");
    expect(encodeBytes(new Uint8Array(0)).data).toBe("");

    // 验证非法输入抛出异常
    expect(() => encodeBytes(123 as any)).toThrow();
    expect(() => encodeBytes(null as any)).toThrow();
  });

  it("encodeText 正确转换纯文本为标准 Bytes", () => {
    const encoded = encodeText("测试文本");
    expect(encoded.encoding).toBe("base64");
    expect(Buffer.from(encoded.data, "base64").toString("utf-8")).toBe("测试文本");
  });

  it("decodeBytes 正确将 base64 Bytes 解码为 Uint8Array", () => {
    const original = new Uint8Array([10, 20, 30, 40]);
    const bytes: Bytes = {
      encoding: "base64",
      data: Buffer.from(original).toString("base64"),
    };

    const decoded = decodeBytes(bytes);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([10, 20, 30, 40]);

    // 验证非法结构抛出异常
    expect(() => decodeBytes(null as any)).toThrow();
    expect(() => decodeBytes({ encoding: "hex" as any, data: "1234" })).toThrow();
    expect(() => decodeBytes({ encoding: "base64", data: 1234 as any })).toThrow();
  });

  it("decodeText 正确解码 Bytes 与 OutputChunk 数组", () => {
    const text = "ActionDock 进程输出测试";
    const bytes = encodeText(text);
    expect(decodeText(bytes)).toBe(text);

    // 验证空数组返回空字符串
    expect(decodeText([])).toBe("");

    // 验证多块拼接解码，包括多字节 UTF-8 跨块切分场景
    const chinese = "你好世界";
    const rawAll = Buffer.from(chinese, "utf-8");
    // "你" 占 3 字节，在此处切为前 2 字节与后 1 字节
    const chunk1Bytes = rawAll.subarray(0, 2);
    const chunk2Bytes = rawAll.subarray(2);

    const chunks: OutputChunk[] = [
      { stream: "stdout", data: encodeBytes(chunk1Bytes) },
      { stream: "stdout", data: encodeBytes(chunk2Bytes) },
    ];

    expect(decodeText(chunks)).toBe(chinese);
  });
});

describe("逐流增量 UTF-8 解码器 createStreamDecoder", () => {
  it("支持单流增量合并多字节 UTF-8 字符", () => {
    const decoder = createStreamDecoder();
    const raw = Buffer.from("中文测试", "utf-8");

    // 切分：第一个字符前 2 字节
    const part1 = raw.subarray(0, 2);
    const part2 = raw.subarray(2, 5);
    const part3 = raw.subarray(5);

    const chunk1: OutputChunk = { stream: "stdout", data: encodeBytes(part1) };
    const chunk2: OutputChunk = { stream: "stdout", data: encodeBytes(part2) };
    const chunk3: OutputChunk = { stream: "stdout", data: encodeBytes(part3) };

    const t1 = decoder.decode(chunk1);
    expect(t1).toBe(""); // 首字符不完整，不输出

    const t2 = decoder.decode(chunk2);
    expect(t2).toBe("中"); // 完成第一个字符并缓存第二个字符前缀

    const t3 = decoder.decode(chunk3);
    expect(t3).toBe("文测试"); // 完成后续全部字符
  });

  it("多流交错输入时各流状态完全隔离互不破坏", () => {
    const decoder = createStreamDecoder();
    const stdoutRaw = Buffer.from("你好", "utf-8");
    const stderrRaw = Buffer.from("警告", "utf-8");

    // stdout 传入首字符前 2 字节
    const out1: OutputChunk = { stream: "stdout", data: encodeBytes(stdoutRaw.subarray(0, 2)) };
    expect(decoder.decode(out1)).toBe("");

    // stderr 传入完整字符
    const err1: OutputChunk = { stream: "stderr", data: encodeBytes(stderrRaw) };
    expect(decoder.decode(err1)).toBe("警告");

    // stdout 传入首字符第 3 字节与后续字节
    const out2: OutputChunk = { stream: "stdout", data: encodeBytes(stdoutRaw.subarray(2)) };
    expect(decoder.decode(out2)).toBe("你好");
  });

  it("支持重载方式传入流名称与数据", () => {
    const decoder = createStreamDecoder();
    const res1 = decoder.decode("pty", encodeText("terminal line\n"));
    expect(res1).toBe("terminal line\n");

    const raw = new TextEncoder().encode("direct bytes");
    const res2 = decoder.decode("pty", raw);
    expect(res2).toBe("direct bytes");
  });

  it("支持 decodeChunks 批量解析", () => {
    const decoder = createStreamDecoder();
    const chunks: OutputChunk[] = [
      { stream: "stdout", data: encodeText("hello ") },
      { stream: "stdout", data: encodeText("world") },
    ];
    expect(decoder.decodeChunks(chunks)).toBe("hello world");
  });

  it("支持 reset 重置指定流或全部流的状态", () => {
    const decoder = createStreamDecoder();
    const raw = Buffer.from("你好", "utf-8");

    // 传入不完整字节
    decoder.decode("stdout", raw.subarray(0, 2));

    // 遇到断层时重置 stdout
    decoder.reset("stdout");

    // 传入新文本，不与断层前遗留的 2 字节产生拼合
    const fresh = decoder.decode("stdout", encodeText("abc"));
    expect(fresh).toBe("abc");
  });

  it("支持 flush 输出残余字符并清理状态", () => {
    const decoder = createStreamDecoder();
    const raw = Buffer.from("你好", "utf-8");

    // 传入不完整字符前 2 字节
    decoder.decode("stdout", raw.subarray(0, 2));

    // 强制刷新输出替换字符
    const flushed = decoder.flush("stdout");
    expect(flushed.length).toBeGreaterThan(0);

    // 再次刷新为空
    expect(decoder.flush("stdout")).toBe("");
  });
});

describe("受管进程控制上下文辅助函数 withControl", () => {
  function createMockProcessAPI(): ProcessAPI & {
    calls: string[];
    acquiredGrant: ControlGrant;
    renewCount: number;
    releasedToken?: string;
    stoppedId?: string;
  } {
    const grant: ControlGrant = {
      token: "initial-token-123",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    const dummyProcessInfo: ProcessInfo = {
      id: "proc-1",
      hostEpoch: "epoch-1",
      state: "running",
      control: "held",
      io: { mode: "pipe" },
      capabilities: {
        pty: false,
        resize: false,
        inputEOF: true,
        interruptForeground: false,
        terminationScope: "process",
      },
      createdAt: new Date().toISOString(),
      outputClosed: false,
      effectiveLimits: {
        idleMs: 1800000,
        lifetimeMs: 28800000,
        outputBufferBytes: 4194304,
      },
    };

    return {
      calls: [],
      acquiredGrant: grant,
      renewCount: 0,
      releasedToken: undefined,
      stoppedId: undefined,

      async run() {
        return { exit: { code: 0, signal: null }, chunks: [], truncated: false };
      },
      async start() {
        return { process: dummyProcessInfo, initialCursor: "c0" };
      },
      async inspect() {
        return dummyProcessInfo;
      },
      async list() {
        return { processes: [dummyProcessInfo] };
      },
      async acquire(_id, input) {
        this.calls.push(`acquire:${input.requestId}`);
        return this.acquiredGrant;
      },
      async renew(_id, token, _ttl) {
        this.calls.push(`renew:${token}`);
        this.renewCount++;
        return {
          token: `renewed-token-${this.renewCount}`,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        };
      },
      async release(_id, token) {
        this.calls.push(`release:${token}`);
        this.releasedToken = token;
      },
      async write(_id, input) {
        return { requestId: input.requestId, state: "completed" };
      },
      async operation(_id, requestId) {
        return { requestId, state: "completed" };
      },
      async read(_id, _input) {
        return {
          chunks: [],
          nextCursor: "c1",
          earliestCursor: "c0",
          tailCursor: "c1",
          truncated: false,
          eof: false,
          process: dummyProcessInfo,
        };
      },
      async control(_id, input) {
        return { requestId: input.requestId, state: "completed" };
      },
      async stop(id, input) {
        this.calls.push(`stop:${input.requestId}`);
        this.stoppedId = id;
        return { ...dummyProcessInfo, state: "stopping" };
      },
    };
  }

  it("正常执行时申请控制权、执行回调并在完成时显式 release", async () => {
    const mockApi = createMockProcessAPI();

    const result = await withControl(
      mockApi,
      "proc-1",
      {
        requestId: "req-normal",
        autoRenew: false,
      },
      async (grant) => {
        expect(grant.token).toBe("initial-token-123");
        return "operation-result";
      }
    );

    expect(result).toBe("operation-result");
    expect(mockApi.calls).toEqual(["acquire:req-normal", "release:initial-token-123"]);
    expect(mockApi.releasedToken).toBe("initial-token-123");
    expect(mockApi.stoppedId).toBeUndefined();
  });

  it("业务函数抛出异常时严禁 release 且按契约调用 stop 进行隔离或终止", async () => {
    const mockApi = createMockProcessAPI();

    await expect(
      withControl(
        mockApi,
        "proc-1",
        {
          requestId: "req-fail",
          autoRenew: false,
        },
        async () => {
          throw new Error("business failure");
        }
      )
    ).rejects.toThrow("business failure");

    expect(mockApi.calls).toContain("acquire:req-fail");
    expect(mockApi.calls).toContain("stop:req-fail-error-stop");
    expect(mockApi.calls.some((c) => c.startsWith("release"))).toBe(false);
    expect(mockApi.stoppedId).toBe("proc-1");
  });

  it("开启 autoRenew 时根据 TTL 按比例自动续租并在完成后释放最新令牌", async () => {
    const mockApi = createMockProcessAPI();

    const result = await withControl(
      mockApi,
      "proc-1",
      {
        requestId: "req-renew",
        ttlMs: 300, // 触发约每 100ms 一次续租
        autoRenew: true,
      },
      async (grant) => {
        // 等待触发至少一次续租
        await new Promise((resolve) => setTimeout(resolve, 250));
        return `done-with-${grant.token}`;
      }
    );

    expect(result).toContain("done-with-renewed-token-");
    expect(mockApi.renewCount).toBeGreaterThanOrEqual(1);
    expect(mockApi.calls).toContain("acquire:req-renew");
    expect(mockApi.releasedToken).toBe(`renewed-token-${mockApi.renewCount}`);
    expect(mockApi.stoppedId).toBeUndefined();
  });

  it("续租失败时停止续租并调用 stop 且向外透传续租异常", async () => {
    const mockApi = createMockProcessAPI();
    mockApi.renew = async () => {
      throw new Error("renew network error");
    };

    await expect(
      withControl(
        mockApi,
        "proc-1",
        {
          requestId: "req-renew-fail",
          ttlMs: 300,
          autoRenew: true,
        },
        async () => {
          // 等待后台续租触发失败
          await new Promise((resolve) => setTimeout(resolve, 250));
          return "should-not-reach";
        }
      )
    ).rejects.toThrow("renew network error");

    expect(mockApi.calls).toContain("acquire:req-renew-fail");
    expect(mockApi.calls).toContain("stop:req-renew-fail-renew-stop");
    expect(mockApi.calls.some((c) => c.startsWith("release"))).toBe(false);
  });

  it("取消信号在调用前已中止时直接抛出取消异常且不申请控制权", async () => {
    const mockApi = createMockProcessAPI();
    const controller = new AbortController();
    controller.abort(new Error("caller aborted early"));

    await expect(
      withControl(
        mockApi,
        "proc-1",
        {
          requestId: "req-pre-abort",
          signal: controller.signal,
        },
        async () => "ok"
      )
    ).rejects.toThrow("caller aborted early");

    expect(mockApi.calls.length).toBe(0);
  });

  it("执行过程中收到取消信号时触发 stop 并在回调完成时抛出取消异常", async () => {
    const mockApi = createMockProcessAPI();
    const controller = new AbortController();

    await expect(
      withControl(
        mockApi,
        "proc-1",
        {
          requestId: "req-mid-abort",
          signal: controller.signal,
          autoRenew: false,
        },
        async () => {
          controller.abort(new Error("midway abort"));
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "cancelled-val";
        }
      )
    ).rejects.toThrow("midway abort");

    expect(mockApi.calls).toContain("acquire:req-mid-abort");
    expect(mockApi.calls).toContain("stop:req-mid-abort-abort-stop");
    expect(mockApi.calls.some((c) => c.startsWith("release"))).toBe(false);
  });

  it("release 失败时调用 stop 进行应急隔离并抛出 release 异常", async () => {
    const mockApi = createMockProcessAPI();
    mockApi.release = async () => {
      throw new Error("release failed: active queued operations");
    };

    await expect(
      withControl(
        mockApi,
        "proc-1",
        {
          requestId: "req-release-fail",
          autoRenew: false,
        },
        async () => "payload"
      )
    ).rejects.toThrow("release failed: active queued operations");

    expect(mockApi.calls).toContain("acquire:req-release-fail");
    expect(mockApi.calls).toContain("stop:req-release-fail-error-stop");
  });

  it("release 抛出 CONTROL_BUSY 临时错误时保留业务结果且不终止进程", async () => {
    const mockApi = createMockProcessAPI();
    mockApi.release = async () => {
      const err: any = new Error("Cannot release control while operations are pending in queue");
      err.code = "CONTROL_BUSY";
      throw err;
    };

    const result = await withControl(
      mockApi,
      "proc-1",
      {
        requestId: "req-release-busy",
        autoRenew: false,
      },
      async () => "business-payload"
    );

    // 业务结果保留，进程未被 stop 终止
    expect(result).toBe("business-payload");
    expect(mockApi.calls).toContain("acquire:req-release-busy");
    expect(mockApi.stoppedId).toBeUndefined();
  });

  it("release 抛出 CONTROL_REVOKED 失效错误时维持 stop 与异常透传契约", async () => {
    const mockApi = createMockProcessAPI();
    mockApi.release = async () => {
      const err: any = new Error("Process control is closed");
      err.code = "CONTROL_REVOKED";
      throw err;
    };

    await expect(
      withControl(
        mockApi,
        "proc-1",
        {
          requestId: "req-release-revoked",
          autoRenew: false,
        },
        async () => "payload"
      )
    ).rejects.toThrow("Process control is closed");

    expect(mockApi.calls).toContain("acquire:req-release-revoked");
    expect(mockApi.calls).toContain("stop:req-release-revoked-error-stop");
  });
});
