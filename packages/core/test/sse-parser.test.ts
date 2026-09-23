import { describe, expect, it } from "bun:test";
import { parseSseMessages, type SseMessage } from "../src/service/sse-parser";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collectMessages(
  chunks: string[],
  options?: { signal?: AbortSignal }
): Promise<SseMessage[]> {
  const messages: SseMessage[] = [];
  for await (const msg of parseSseMessages(sseStream(chunks), options)) {
    messages.push(msg);
  }
  return messages;
}

describe("SSE 流解析器单职责模块", () => {
  it("正常解析完整事件流：注释忽略、字段解析与空行分发", async () => {
    const messages = await collectMessages([
      ": keep alive comment\n" +
        "id: evt-1\n" +
        "event: status\n" +
        "data: {\"status\": \"running\"}\n" +
        "\n" +
        "id: evt-2\r" +
        "event: finish\r" +
        "data: {\"ok\": true}\r" +
        "\r" +
        "retry: 1000\n" +
        "event: note\n" +
        "data: {\"msg\": \"unknown field above ignored\"}\r\n\r\n",
    ]);

    expect(messages.length).toBe(3);
    expect(messages[0]).toEqual({
      event: "status",
      id: "evt-1",
      data: '{"status": "running"}',
    });
    expect(messages[1]).toEqual({
      event: "finish",
      id: "evt-2",
      data: '{"ok": true}',
    });
    expect(messages[2].event).toBe("note");
    expect(messages[2].id).toBeUndefined();
    expect(messages[2].data).toContain("unknown field above ignored");
  });

  it("跨 chunk 分割时正确缓冲：回车位于分片边界暂存等待下个分片", async () => {
    // 分片刻意在 \r 边界与行中间切断，解析器必须跨分片拼接还原完整行
    const messages = await collectMessages([
      "id: chunk-1\r",
      "event: chun",
      "ked\r\ndata: {\"part\"",
      ": 1}\r",
      "\n\r",
      "\n",
    ]);

    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual({
      event: "chunked",
      id: "chunk-1",
      data: '{"part": 1}',
    });
  });

  it("多行 data 按换行拼接合并且仅剔除冒号后首个空格", async () => {
    const messages = await collectMessages([
      "event: multiline\n",
      "data: {\n",
      "data:   \"line1\": \"hello\",\n",
      "data:   \"line2\": \"world\"\n",
      "data: }\n",
      "\n",
      "event: spaced\r\n",
      "data:  {\"text\": \"  padded  \"} \r\n",
      "\r\n",
    ]);

    expect(messages.length).toBe(2);
    expect(messages[0].data).toBe(
      "{\n  \"line1\": \"hello\",\n  \"line2\": \"world\"\n}"
    );
    // 冒号后单空格剔除，载荷内部与末尾空格原样保留
    expect(messages[1].data).toBe(' {"text": "  padded  "} ');
  });
});
