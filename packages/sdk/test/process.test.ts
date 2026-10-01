import { describe, expect, it } from "bun:test";
import {
  createStreamDecoder,
  decodeBytes,
  decodeText,
  encodeBytes,
  encodeText,
} from "../src/process";
import type {
  Bytes,
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
