# 实战指南：高可用外部 API 接入

调用外部 REST 服务或云平台是高频场景。本指南说明如何编写高可用 Action。内容涵盖凭据注入、取消响应、指数退避重试与通道隔离。

---

## 业务痛点与设计原则

随手编写的网络请求脚本往往存在工程隐患：

- 凭据硬编码：直接将私钥或令牌写在代码中，造成安全隐患。
- 僵尸连接堆积：客户端超时或取消请求时，未中止底层 HTTP 连接。套接字泄漏会导致后台持续空转。
- 偶发网络抖动导致失败：缺乏对服务暂时不可用（503）或限流（429）的退避重试处理。
- 诊断日志污染协议信封：滥用 `console.log` 打印请求详情，破坏标准输出中的 JSON 协议报文。

ActionDock 倡导规范的网络请求标准：配置注入凭据，请求绑定取消信号。错误退避可恢复，诊断日志隔离至标准错误。

---

## 清单配置声明

在 `actiondock.json` 中声明外部 API 的基地址与访问凭据：

```json
{
  "config": {
    "EXTERNAL_API_BASE": {
      "description": "第三方服务 API 基地址",
      "type": "string",
      "default": "https://api.example.com"
    },
    "EXTERNAL_API_TOKEN": {
      "description": "第三方服务访问令牌",
      "type": "string",
      "secret": true,
      "env": "EXTERNAL_API_TOKEN"
    }
  },
  "actions": {
    "external.fetch-data": {
      "entry": "actions/fetch-data.ts",
      "description": "从第三方服务高可靠获取业务数据",
      "inputSchema": {
        "type": "object",
        "properties": {
          "resourceId": { "type": "string", "description": "目标资源唯一标识" }
        },
        "required": ["resourceId"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "status": { "type": "string" },
          "payload": { "type": "object" }
        },
        "required": ["id", "status", "payload"]
      }
    }
  }
}
```

---

## 编写高可用业务实现

在 `actions/fetch-data.ts` 中实现网络请求，集成指数退避与信号透传：

```ts
import { defineAction } from "@actiondock/sdk";

export interface FetchDataInput {
  resourceId: string;
}

export interface FetchDataOutput {
  id: string;
  status: string;
  payload: Record<string, unknown>;
}

export default defineAction(async (input: FetchDataInput, ctx): Promise<FetchDataOutput> => {
  const baseUrl = ctx.config.get<string>("EXTERNAL_API_BASE", "https://api.example.com");
  const token = ctx.config.get<string>("EXTERNAL_API_TOKEN");

  if (!token) {
    throw new Error("缺少必要的外部访问令牌 EXTERNAL_API_TOKEN");
  }

  const targetUrl = `${baseUrl}/resources/${encodeURIComponent(input.resourceId)}`;
  const maxRetries = 3;
  let attempt = 0;
  let delayMs = 500;

  while (attempt < maxRetries) {
    attempt++;
    ctx.log.info(`发起网络请求 [重试次序 ${attempt}/${maxRetries}]: ${targetUrl}`);

    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        // 关键：必须透传 ctx.signal 实现连接级别协作式取消
        signal: ctx.signal,
      });

      // 处理速率限制 (429) 或服务暂时不可用 (503)
      if (response.status === 429 || response.status === 503) {
        ctx.log.warn(`服务端返回状态 ${response.status}，执行退避等待 ${delayMs} 毫秒`);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(ctx.signal.reason);
          }, { once: true });
        });
        delayMs *= 2;
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`外部服务响应异常 [${response.status}]: ${errorBody}`);
      }

      const data = (await response.json()) as { id: string; status: string; data: Record<string, unknown> };

      ctx.log.info(`资源 ${input.resourceId} 数据获取成功`);

      return {
        id: data.id,
        status: data.status,
        payload: data.data,
      };
    } catch (err) {
      // 若是由于取消信号触发的中止，立即向上抛出不再重试
      if (ctx.signal.aborted) {
        throw err;
      }

      if (attempt >= maxRetries) {
        ctx.log.error(`超过最大重试次数，请求终止: ${(err as Error).message}`);
        throw err;
      }

      ctx.log.warn(`请求遇到网络异常: ${(err as Error).message}，准备重试`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }

  throw new Error(`无法获取资源 ${input.resourceId} 的数据`);
});
```

---

## 编写确定性单元测试

在 `tests/fetch-data.test.ts` 中验证业务逻辑与取消信号传播：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import fetchDataAction from "../actions/fetch-data.js";

describe("外部 API 接入测试", () => {
  it("缺少必要令牌时应当快速抛出错误", async () => {
    const runtime = createTestRuntime({
      config: {
        EXTERNAL_API_BASE: "https://mock.api.internal",
      },
    });

    await assert.rejects(
      async () => {
        await runtime.run(fetchDataAction, { resourceId: "res-101" });
      },
      {
        message: /缺少必要的外部访问令牌/,
      }
    );
  });
});
```
